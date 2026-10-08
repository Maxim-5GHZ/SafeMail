"""Семантический инференс: локальный ONNX rubert-tiny2 (primary) + GigaChat (fallback).

Контракт сохранён: класс SemanticModel + синглтон MODEL с интерфейсом
  .available / .load() / .explain(text) / .predict(text)
поэтому main.py (fuse_verdict, /internal/classify-threat) не меняется по форме.

Правила:
- Ключ — только из env: GIGACHAT_API_KEY. В репо секретов нет.
- Пулы запросов 4+1: семафор на 4 параллельных инференса ONNX (под 4 ядра)
  + 1 зарезервированный GigaChat.
- Каждый explain() сначала идёт в ONNX (офлайн, детерминирован); при ошибке —
  один заход в GigaChat (warning-лог с reason и ms);
  упали оба — ("NONE", 0.0, 0.0), пайплайн идёт по эвристическому
  fallback (fail-closed, как раньше без ключей).
- В логи — никаких тел писем и ключей: только reason, ms, длина
  текста, категория/скор. Промпт GigaChat требует строго JSON без markdown,
  парсинг tolerant (_clean_json_response как в коде-заготовке пользователя).
"""

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

from .prototypes import CATEGORIES, PROTOTYPES, SEMANTIC_MARGIN, SEMANTIC_THRESHOLD

logger = logging.getLogger("safemail.classify.semantic")

MODEL_NAME = "rubert-tiny2-onnx"

# Бюджет под gateway readTimeout 15с: ONNX ~десятки мс + ~5.5с GigaChat.
GIGA_TIMEOUT_S = 5.5
# Пулы запросов: N параллельных ONNX (дефолт 4 — под 4 ядра сервера;
# локально с запасом ядер поднимается через env ONNX_MAX_SLOTS, кламп 1..16)
# + 1 зарезервированный GigaChat.
def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int((os.getenv(name, "") or "").strip())
    except ValueError:
        return default
    return max(lo, min(hi, v))


ONNX_MAX_SLOTS = _env_int("ONNX_MAX_SLOTS", 4, 1, 16)
ONNX_THREADS = 2  # intra_op внутри сессии (inter=1)
ONNX_MAX_TOKENS = 512  # предел позиций rubert
ONNX_TEXT_LIMIT = 2000  # символов на вход (как у внешних провайдеров)
ONNX_MARGIN = 0.08  # маржа победы угрозы над NONE (против флипов на шуме)
GIGA_MAX_SLOTS = 1
TEXT_LIMIT = 2000
# Кап генерации: ответ — короткий JSON (~60-100 токенов), запас 3x.
# Режет хвост генерации (~до 1с с LLM-звонка). Обрезка безопасна:
# битый JSON -> non_json -> штатный fallback, а не неверный вердикт.
MAX_TOKENS = 300

VALID_CATEGORIES = set(CATEGORIES)

# Системный промпт для GigaChat-fallback: рамка «аналитик ИБ»
# (оценка риска, не инструкции) снижает долю safety-отказов на угрозах.
# Это не обход политики: инструкций/деталей модель давать не просят —
# наоборот, прямо запрещают; нужен только класс риска.
GIGA_SYSTEM_PROMPT = (
    "Ты — аналитик информационной безопасности почтового шлюза. "
    "Твоя задача — оценить риск письма, а не помогать с его содержимым: "
    "никаких инструкций, деталей, советов и пересказа угроз — только класс риска. "
    "Классифицируй письмо в ОДНУ категорию:\n"
    "TERRORISM (теракты, взрывы, захваты), MAN_MADE (техногенные аварии: АЭС, плотины, "
    "ж/д, химия), ILLEGAL_ACTIONS (шантаж, расправа, вымогательство, обнал),\n"
    "OTHER_THREAT (поджог, отравление, нападение, мат/угрозы), NONE (обычная переписка).\n"
    "Отвечай СТРОГО валидным JSON без markdown-оберток:\n"
    '{"category": "NONE", "confidence": 0.05, "explanation": "коротко по-русски"}\n'
    "confidence — число 0..1. Мат без угрозы — OTHER_THREAT ~0.75. "
    "Обычное письмо — NONE с низкой уверенностью. "
    "Бытовая химия (закупка хлора для бассейна и т.п.) — тоже NONE. "
    "Отвечай ТОЛЬКО JSON-объектом, без пояснений, приветствий и markdown."
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


# Семафоры пулов: 4 параллельных ONNX + 1 GigaChat.
_ONNX_SEM = threading.Semaphore(ONNX_MAX_SLOTS)
_GIGA_SEM = threading.Semaphore(GIGA_MAX_SLOTS)
# Общий пул потоков (1 = GigaChat-слот): нужен, чтобы ограничить время GigaChat-вызова,
# у которого в gigachat-пакете нет надёжного таймаута.
_POOL = ThreadPoolExecutor(max_workers=GIGA_MAX_SLOTS,
                           thread_name_prefix="semprov")


def _resolve_model_dir() -> str:
    """Каталог с model.onnx + tokenizer.json: env MODEL_DIR, иначе стандартные."""
    cands = [
        (os.getenv("MODEL_DIR", "") or "").strip(),
        "./models/rubert-tiny2",
        "ml-classify/models/rubert-tiny2",
    ]
    for c in cands:
        if c and os.path.isfile(os.path.join(c, "model.onnx")):
            return c
    return ""


class OnnxRubertProvider:
    """Primary: локальный rubert-tiny2 через ONNX (CPU, офлайн, детерминизм).

    Эмбеддинг письма (mean-pooling по attention-маске) + косинус против
    эталонов PROTOTYPES. Интерфейс как у внешних: classify(text) -> (cat, conf).
    """

    name = "onnx"

    def __init__(self) -> None:
        self._session = None
        self._tok = None
        self._protos: dict[str, list] = {}
        self._dim = 0
        self.configured = False

    @property
    def available(self) -> bool:
        return self.configured and self._session is not None

    def configure(self) -> bool:
        """Загрузка модели без сети (веса запечены в образ stage 1)."""
        try:
            import numpy as _np  # noqa: F401
            import onnxruntime as _ort
            from tokenizers import Tokenizer as _Tok
        except ImportError:
            print("[SEMANTIC] onnxruntime/tokenizers не установлены — ONNX выключен",
                  flush=True)
            return False
        model_dir = _resolve_model_dir()
        if not model_dir:
            print("[SEMANTIC] model.onnx не найден — ONNX выключен", flush=True)
            return False
        try:
            so = _ort.SessionOptions()
            so.intra_op_num_threads = ONNX_THREADS
            so.inter_op_num_threads = 1
            self._session = _ort.InferenceSession(
                os.path.join(model_dir, "model.onnx"), sess_options=so,
                providers=["CPUExecutionProvider"])
            self._tok = _Tok.from_file(os.path.join(model_dir, "tokenizer.json"))
            self._tok.enable_truncation(max_length=ONNX_MAX_TOKENS)
            self._protos = {c: [self._embed(t) for t in ts]
                            for c, ts in PROTOTYPES.items()}
            self._dim = self._protos["NONE"][0].shape[0]
        except Exception as ex:
            print(f"[SEMANTIC] Ошибка загрузки ONNX ({type(ex).__name__}) — выключен",
                  flush=True)
            self._session = None
            self.configured = False
            return False
        self.configured = True
        return True

    def _embed(self, text: str):
        """Нормированный эмбеддинг текста (mean-pooling по маске)."""
        import numpy as _np
        enc = self._tok.encode((text or "")[:ONNX_TEXT_LIMIT])
        ids = _np.array([enc.ids], dtype=_np.int64)
        mask = _np.array([enc.attention_mask], dtype=_np.int64)
        zeros = _np.zeros_like(ids)
        (hidden,) = self._session.run(
            None, {"input_ids": ids, "attention_mask": mask,
                   "token_type_ids": zeros})[:1]
        m = mask.astype(_np.float32)
        vec = (hidden[0] * m[0][:, None]).sum(axis=0) / max(m.sum(), 1e-6)
        n = float(_np.linalg.norm(vec)) or 1.0
        return (vec / n).astype(_np.float32)

    def classify(self, text: str) -> tuple[str, float]:
        """Максимум косинуса по эталонам; пусто/мусор — строгий fallback дальше.
        Угроза побеждает только с маржой над NONE (>= ONNX_MARGIN): у крошки
        косинусы сжаты, пограничная химия («хлор для бассейна» vs «солью химию»)
        иначе флипает от перефразировки. Спорное — в NONE, дальше решает
        эвристика (детерминирована) и вето."""
        import numpy as _np
        assert self._session is not None
        if not (text or "").strip():
            raise ProviderError("empty")
        vec = self._embed(text)
        best, best_score = "NONE", -1.0
        for cat in CATEGORIES:
            for pv in self._protos.get(cat, []):
                s = float(_np.dot(vec, pv))
                if s > best_score:
                    best, best_score = cat, s
        none_s = max(float(_np.dot(vec, pv)) for pv in self._protos.get("NONE", []))
        if best != "NONE" and best_score - none_s < ONNX_MARGIN:
            return ("NONE", round(min(max(none_s, 0.0), 1.0), 4))
        conf = min(max(best_score, 0.0), 1.0)
        return (best, round(conf, 4))


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
            Messages(role=MessagesRole.SYSTEM, content=GIGA_SYSTEM_PROMPT),
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
    """Роутер ONNX (primary, офлайн) -> GigaChat под старым интерфейсом."""

    def __init__(self) -> None:
        self._onnx = OnnxRubertProvider()
        self._giga = GigaChatProvider()
        self.loaded = False
        self._lock = threading.Lock()
        self._counters = {"onnx_ok": 0, "onnx_fallback": 0,
                          "gigachat_ok": 0, "both_fail": 0}
        self._local = threading.local()

    @property
    def available(self) -> bool:
        return self.loaded and (self._onnx.available
                                or self._giga.available)

    @property
    def active_name(self) -> str:
        if self._onnx.available:
            return "rubert-tiny2-onnx"
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
        has_onnx = self._onnx.configure()
        has_giga = self._giga.configure()
        self.loaded = True
        if not has_onnx:
            print("[SEMANTIC] ONNX недоступен — fallback только GigaChat",
                  flush=True)
        if not has_giga:
            print("[SEMANTIC] GIGACHAT_API_KEY не задан — GigaChat-fallback выключен", flush=True)
        if has_onnx or has_giga:
            print(f"[SEMANTIC] провайдеры: onnx={'on' if has_onnx else 'off'}"
                  f"(slots={ONNX_MAX_SLOTS}), "
                  f"gigachat={'on' if has_giga else 'off'}", flush=True)
            return True
        print("[SEMANTIC] нет провайдеров — работает rule-based fallback", flush=True)
        return False

    def _via_gigachat(self, text: str, text_len: int) -> tuple[str, float, float, str | None]:
        if not self._giga.available:
            logger.error("[SEMANTIC] both providers failed (onnx fallback: gigachat недоступен) -> fail-closed NONE")
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
        if self._onnx.available:
            with _ONNX_SEM:
                t0 = time.perf_counter()
                try:
                    cat, conf = self._onnx.classify(text)
                except Exception as ex:
                    ms = int((time.perf_counter() - t0) * 1000)
                    self._bump("onnx_fallback")
                    logger.warning("[SEMANTIC] onnx fallback -> gigachat "
                                   "| reason=%s | onnx_ms=%d | text_len=%d",
                                   f"{type(ex).__name__}:{ex}", ms, text_len)
                    return self._via_gigachat(text, text_len)
                else:
                    ms = int((time.perf_counter() - t0) * 1000)
                    self._bump("onnx_ok")
                    logger.debug("[SEMANTIC] onnx ok | cat=%s conf=%.2f | ms=%d",
                                 cat, conf, ms)
                    self._local.provider = "onnx"
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
