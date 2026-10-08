"""Семантический инференс: Mistral через OpenRouter (primary) + GigaChat (fallback).

Контракт сохранён: класс SemanticModel + синглтон MODEL с интерфейсом
  .available / .load() / .explain(text) / .predict(text)
поэтому main.py (fuse_verdict, /internal/classify-threat) не меняется по форме.

Правила:
- Ключи — только из env: OPENROUTER_API_KEY (+ OPENROUTER_MODEL, дефолт
  mistral-small-24b) и GIGACHAT_API_KEY. В репо секретов нет.
- Пулы запросов 6+1: семафор на 6 параллельных вызовов Mistral и 1 —
  GigaChat; httpx-клиент Mistral с keep-alive (max_connections=6).
- Каждый explain() сначала идёт в Mistral; при ошибке/таймауте/не-JSON/
  safety-блоке — один заход в GigaChat (warning-лог с reason и ms);
  упали оба — ("NONE", 0.0, 0.0), пайплайн идёт по эвристическому
  fallback (fail-closed, как раньше без ключей).
- В логи — никаких тел писем и ключей: только reason, ms, длина
  текста, категория/скор. Промпт требует строго JSON без markdown,
  парсинг tolerant (_clean_json_response как в коде-заготовке пользователя).
"""

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

import httpx

from .prototypes import CATEGORIES, SEMANTIC_MARGIN, SEMANTIC_THRESHOLD

logger = logging.getLogger("safemail.classify.semantic")

MODEL_NAME = "mistral-small-24b"

OPENROUTER_DEFAULT_MODEL = "mistralai/mistral-small-24b-instruct-2501"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
# Бюджет под gateway readTimeout 15с: 8с Mistral + ~5.5с GigaChat.
MISTRAL_TIMEOUT_S = 8.0
GIGA_TIMEOUT_S = 5.5
# Пулы запросов: 6 параллельных Mistral + 1 зарезервированный GigaChat.
MISTRAL_MAX_SLOTS = 6
GIGA_MAX_SLOTS = 1
TEXT_LIMIT = 2000
# Кап генерации: ответ — короткий JSON (~60-100 токенов), запас 3x.
# Режет хвост генерации (~до 1с с LLM-звонка). Обрезка безопасна:
# битый JSON -> non_json -> штатный fallback, а не неверный вердикт.
MAX_TOKENS = 300

VALID_CATEGORIES = set(CATEGORIES)

SYSTEM_PROMPT_CLASSIFY = (
    "Ты — SLM, компактная языковая модель почтового шлюза СейфМейл. "
    "Ты — фильтр безопасности, а не общий чат-бот. Классифицируй письмо в ОДНУ категорию:\n"
    "TERRORISM (теракты, взрывы, захваты), MAN_MADE (техногенные аварии: АЭС, плотины, "
    "ж/д, химия), ILLEGAL_ACTIONS (шантаж, расправа, вымогательство, обнал),\n"
    "OTHER_THREAT (поджог, отравление, нападение, мат/угрозы), NONE (обычная переписка).\n"
    "Отвечай от лица SLM, СТРОГО валидным JSON без markdown-оберток:\n"
    '{"category": "NONE", "confidence": 0.05, "explanation": "коротко по-русски"}\n'
    "confidence — число 0..1. Мат без угрозы — OTHER_THREAT ~0.75. "
    "Обычное письмо — NONE с низкой уверенностью."
)

_SAFETY_TRIGGERS = (
    "генеративные языковые модели",
    "чувствительными темами",
    "временно ограничены",
    "во избежание неправильного толкования",
    "некорректные ответы",
)


def _is_safety_block(text: str) -> bool:
    return any(t in (text or "") for t in _SAFETY_TRIGGERS)


def _clean_json_response(text: str) -> str:
    text = (text or "").strip()
    start_idx = text.find("{")
    end_idx = text.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        return text[start_idx:end_idx + 1]
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").strip()
        if text.endswith("```"):
            text = text.removesuffix("```").strip()
    return text


def _parse_llm_answer(raw: str) -> tuple[str, float]:
    """Строгий разбор ответа LLM -> (категория, уверенность). Мусор -> NONE."""
    try:
        data = json.loads(_clean_json_response(raw))
        cat = str(data.get("category", "NONE")).strip().upper()
        if cat not in VALID_CATEGORIES:
            return ("NONE", 0.0)
        conf = float(data.get("confidence", 0.0))
        conf = min(max(conf, 0.0), 1.0)
        return (cat, round(conf, 4))
    except Exception:
        logger.warning("LLM: не JSON, fallback NONE")
        return ("NONE", 0.0)


class ProviderError(Exception):
    """Ошибка провайдера с классифицированной причиной для логов."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


# Семафоры пулов: 6 параллельных Mistral + 1 GigaChat (fallback не ждёт очередь).
_MISTRAL_SEM = threading.Semaphore(MISTRAL_MAX_SLOTS)
_GIGA_SEM = threading.Semaphore(GIGA_MAX_SLOTS)
# Общий пул потоков (7 = 6+1): нужен, чтобы ограничить время GigaChat-вызова,
# у которого в gigachat-пакете нет надёжного таймаута.
_POOL = ThreadPoolExecutor(max_workers=MISTRAL_MAX_SLOTS + GIGA_MAX_SLOTS,
                           thread_name_prefix="semprov")


class MistralOpenRouterProvider:
    """Primary: Mistral Small через OpenRouter Chat Completions (httpx)."""

    name = "mistral"

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._model = OPENROUTER_DEFAULT_MODEL
        self._headers: dict[str, str] = {}
        self.configured = False

    @property
    def available(self) -> bool:
        return self.configured and self._client is not None

    def configure(self) -> bool:
        """Чтение env без сетевых вызовов (сеть — только в classify)."""
        api_key = (os.getenv("OPENROUTER_API_KEY", "") or "").strip()
        if not api_key:
            return False
        self._model = (os.getenv("OPENROUTER_MODEL", "") or "").strip() or OPENROUTER_DEFAULT_MODEL
        referer = (os.getenv("OPENROUTER_REFERER", "") or "").strip() or "https://safemail.local"
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": referer,
            "X-Title": "SafeMail",
        }
        self._client = httpx.Client(
            timeout=httpx.Timeout(MISTRAL_TIMEOUT_S),
            limits=httpx.Limits(max_connections=MISTRAL_MAX_SLOTS,
                                max_keepalive_connections=MISTRAL_MAX_SLOTS),
        )
        self.configured = True
        return True

    def classify(self, text: str) -> tuple[str, float]:
        """Строго: любая аномалия ответа — ProviderError (роутер уйдёт в GigaChat)."""
        assert self._client is not None
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT_CLASSIFY},
                {"role": "user", "content": (text or "")[:TEXT_LIMIT]},
            ],
            "temperature": 0,
            "max_tokens": MAX_TOKENS,
        }
        try:
            resp = self._client.post(OPENROUTER_API_URL, json=payload, headers=self._headers)
        except httpx.TimeoutException:
            raise ProviderError("timeout")
        except httpx.HTTPError as ex:
            raise ProviderError(f"network:{type(ex).__name__}")
        if resp.status_code == 429:
            raise ProviderError("http_429")
        if resp.status_code >= 500:
            raise ProviderError("http_5xx")
        if resp.status_code != 200:
            raise ProviderError(f"http_{resp.status_code}")
        try:
            data = resp.json()
            raw = data["choices"][0]["message"]["content"]
        except Exception:
            raise ProviderError("non_json")
        if _is_safety_block(raw):
            raise ProviderError("safety")
        try:
            parsed = json.loads(_clean_json_response(raw))
            cat = str(parsed.get("category", "NONE")).strip().upper()
            conf = float(parsed.get("confidence", 0.0))
            conf = min(max(conf, 0.0), 1.0)
        except Exception:
            raise ProviderError("non_json")
        if cat not in VALID_CATEGORIES:
            raise ProviderError("non_json")
        return (cat, round(conf, 4))


class GigaChatProvider:
    """Fallback: GigaChat (один зарезервированный слот). Поведение как раньше."""

    name = "gigachat"

    def __init__(self) -> None:
        self._giga = None
        self.configured = False

    @property
    def available(self) -> bool:
        return self.configured and self._giga is not None

    def configure(self) -> bool:
        """Инициализация без сетевых вызовов (сеть — только в classify)."""
        api_key = (os.getenv("GIGACHAT_API_KEY", "") or "").strip()
        if not api_key:
            return False
        try:
            from gigachat import GigaChat  # type: ignore
        except ImportError:
            print("[SEMANTIC] пакет gigachat не установлен — fallback без GigaChat", flush=True)
            return False
        try:
            self._giga = GigaChat(credentials=api_key, verify_ssl_certs=False)
            self.configured = True
            return True
        except Exception as e:
            print(f"[SEMANTIC] Ошибка init GigaChat: {e} — fallback без GigaChat", flush=True)
            self._giga = None
            self.configured = False
            return False

    def _call(self, text: str) -> str:
        from gigachat.models import Chat, Messages, MessagesRole  # type: ignore

        messages = [
            Messages(role=MessagesRole.SYSTEM, content=SYSTEM_PROMPT_CLASSIFY),
            Messages(role=MessagesRole.USER, content=(text or "")[:TEXT_LIMIT]),
        ]
        response = self._giga.chat(Chat(messages=messages, max_tokens=MAX_TOKENS))
        return response.choices[0].message.content

    def classify(self, text: str) -> tuple[str, float]:
        """Мягко, как раньше: мусор/safety — исключение с reason (роутер залогирует)."""
        try:
            raw = self._call(text)
        except Exception as ex:
            raise ProviderError(f"exception:{type(ex).__name__}")
        if _is_safety_block(raw):
            raise ProviderError("safety")
        cat, conf = _parse_llm_answer(raw)
        # _parse_llm_answer отдаёт ("NONE", 0.0) на мусор — для fallback-провайдера
        # это fail-closed нули (дальше идти некуда), reason фиксируем отдельно.
        if cat == "NONE" and conf == 0.0:
            raise ProviderError("non_json")
        return (cat, conf)


class SemanticModel:
    """Роутер Mistral (primary) -> GigaChat (fallback) под старым интерфейсом."""

    def __init__(self) -> None:
        self._mistral = MistralOpenRouterProvider()
        self._giga = GigaChatProvider()
        self.loaded = False
        self._lock = threading.Lock()
        self._counters = {"mistral_ok": 0, "mistral_fallback": 0,
                          "gigachat_ok": 0, "both_fail": 0}
        self._local = threading.local()

    @property
    def available(self) -> bool:
        return self.loaded and (self._mistral.available or self._giga.available)

    @property
    def active_name(self) -> str:
        if self._mistral.available:
            return "mistral-small-24b"
        if self._giga.available:
            return "gigachat"
        return "none"

    @property
    def last_provider(self) -> str:
        """Кто дал семантику в этом потоке (для флага semantic-provider)."""
        return getattr(self._local, "provider", self.active_name)

    @property
    def counters(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)

    def _bump(self, key: str) -> None:
        with self._lock:
            self._counters[key] = self._counters.get(key, 0) + 1

    def load(self, model_dir: str | None = None) -> bool:
        """Инициализация без сетевых вызовов (сеть — только в explain)."""
        _ = model_dir  # остался для совместимости lifespan
        has_mistral = self._mistral.configure()
        has_giga = self._giga.configure()
        self.loaded = True
        if not has_mistral:
            print("[SEMANTIC] OPENROUTER_API_KEY не задан — Mistral выключен", flush=True)
        if not has_giga:
            print("[SEMANTIC] GIGACHAT_API_KEY не задан — GigaChat-fallback выключен", flush=True)
        if has_mistral or has_giga:
            print(f"[SEMANTIC] провайдеры: mistral={'on' if has_mistral else 'off'}, "
                  f"gigachat={'on' if has_giga else 'off'}", flush=True)
            return True
        print("[SEMANTIC] нет провайдеров — работает rule-based fallback", flush=True)
        return False

    def _via_gigachat(self, text: str, text_len: int) -> tuple[str, float, float, str | None]:
        if not self._giga.available:
            logger.error("[SEMANTIC] mistral fallback: gigachat недоступен -> fail-closed NONE")
            self._bump("both_fail")
            return ("NONE", 0.0, 0.0, None)
        with _GIGA_SEM:
            t0 = time.perf_counter()
            fut = _POOL.submit(self._giga.classify, text)
            try:
                cat, conf = fut.result(timeout=GIGA_TIMEOUT_S)
            except FuturesTimeoutError:
                fut.cancel()
                reason = "timeout"
                cat, conf = None, None
            except ProviderError as ex:
                reason = ex.reason
                cat, conf = None, None
            except Exception as ex:  # pragma: no cover — страховка
                reason = f"exception:{type(ex).__name__}"
                cat, conf = None, None
            ms = int((time.perf_counter() - t0) * 1000)
        if cat is None:
            logger.error("[SEMANTIC] both providers failed -> fail-closed NONE "
                         "| giga_reason=%s | ms=%d", reason, ms)
            self._bump("both_fail")
            return ("NONE", 0.0, 0.0, None)
        logger.info("[SEMANTIC] gigachat fallback ok | cat=%s conf=%.2f | ms=%d",
                    cat, conf, ms)
        self._bump("gigachat_ok")
        self._local.provider = "gigachat"
        none_score = 0.9 if cat == "NONE" else round(1.0 - conf, 4)
        return (cat, conf, none_score, None)

    def explain(self, text: str) -> tuple[str, float, float, str | None]:
        """(лучшая категория, её скор, скор NONE, ближайший эталон=None).
        Нет провайдеров/пусто/оба упали — ("NONE", 0.0, 0.0, None)."""
        if not self.available or not (text or "").strip():
            return ("NONE", 0.0, 0.0, None)
        text_len = len(text or "")
        if self._mistral.available:
            with _MISTRAL_SEM:
                t0 = time.perf_counter()
                try:
                    cat, conf = self._mistral.classify(text)
                except ProviderError as ex:
                    ms = int((time.perf_counter() - t0) * 1000)
                    self._bump("mistral_fallback")
                    logger.warning("[SEMANTIC] mistral fallback -> gigachat "
                                   "| reason=%s | mistral_ms=%d | text_len=%d",
                                   ex.reason, ms, text_len)
                    return self._via_gigachat(text, text_len)
                ms = int((time.perf_counter() - t0) * 1000)
            self._bump("mistral_ok")
            logger.debug("[SEMANTIC] mistral ok | cat=%s conf=%.2f | ms=%d", cat, conf, ms)
            self._local.provider = "mistral"
            none_score = 0.9 if cat == "NONE" else round(1.0 - conf, 4)
            return (cat, conf, none_score, None)
        return self._via_gigachat(text, text_len)

    def predict(self, text: str) -> tuple[str, float]:
        """Консервативно: угроза только при score >= THRESHOLD и марже над NONE."""
        best, score, none, _ = self.explain(text)
        if best == "NONE":
            return ("NONE", score)
        if score >= SEMANTIC_THRESHOLD and score - none >= SEMANTIC_MARGIN:
            return (best, score)
        return ("NONE", score)


MODEL = SemanticModel()
