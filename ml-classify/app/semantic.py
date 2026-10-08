"""Семантический инференс через GigaChat (внешний LLM) вместо локальной SLM.

Контракт сохранён: класс SemanticModel + синглтон MODEL с интерфейсом
  .available / .load() / .explain(text) / .predict(text)
поэтому main.py (fuse_verdict, /internal/classify-threat) не меняется по форме.

Правила:
- Ключ — только из env GIGACHAT_API_KEY (в репо секретов нет).
- Библиотеки gigachat нет или ключа нет/сеть недоступна —
  predict возвращает ("NONE", 0.0), пайплайн идёт по эвристическому
  fallback (как раньше без ONNX-файла).
- Промпт требует строго JSON без markdown, парсинг tolerant
  (_clean_json_response как в коде-заготовке пользователя).
"""

import json
import logging
import os

from .prototypes import CATEGORIES, SEMANTIC_MARGIN, SEMANTIC_THRESHOLD

logger = logging.getLogger(__name__)

MODEL_NAME = "gigachat"

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
        logger.warning("GigaChat: не JSON, fallback NONE")
        return ("NONE", 0.0)


class SemanticModel:
    """GigaChat-бэкенд под старым именем/интерфейсом (main.py не ломается)."""

    def __init__(self) -> None:
        self._giga = None
        self.loaded = False

    @property
    def available(self) -> bool:
        return self.loaded and self._giga is not None

    def load(self, model_dir: str | None = None) -> bool:
        """Инициализация без сетевых вызовов (сеть — только в explain)."""
        _ = model_dir  # больше не используется (остался для совместимости lifespan)
        api_key = (os.getenv("GIGACHAT_API_KEY", "") or "").strip()
        if not api_key:
            print("[SEMANTIC] GIGACHAT_API_KEY не задан — работает rule-based fallback", flush=True)
            return False
        try:
            from gigachat import GigaChat  # type: ignore
        except ImportError:
            print("[SEMANTIC] пакет gigachat не установлен — fallback без ИИ", flush=True)
            return False
        try:
            self._giga = GigaChat(credentials=api_key, verify_ssl_certs=False)
            self.loaded = True
            print("[SEMANTIC] GigaChat-провайдер активен", flush=True)
            return True
        except Exception as e:
            print(f"[SEMANTIC] Ошибка init GigaChat: {e} — fallback без ИИ", flush=True)
            self._giga = None
            self.loaded = False
            return False

    def _call(self, text: str) -> str:
        from gigachat.models import Chat, Messages, MessagesRole  # type: ignore

        messages = [
            Messages(role=MessagesRole.SYSTEM, content=SYSTEM_PROMPT_CLASSIFY),
            Messages(role=MessagesRole.USER, content=text[:2000]),
        ]
        payload = Chat(messages=messages)
        response = self._giga.chat(payload)
        return response.choices[0].message.content

    def explain(self, text: str) -> tuple[str, float, float, str | None]:
        """(лучшая категория, её скор, скор NONE, ближайший эталон=None).
        Недоступна/пусто/ошибка/safety-блок — ("NONE", 0.0, 0.0, None)."""
        if not self.available or not (text or "").strip():
            return ("NONE", 0.0, 0.0, None)
        try:
            raw = self._call(text)
            if _is_safety_block(raw):
                logger.warning("GigaChat safety-block, fallback NONE")
                return ("NONE", 0.0, 0.0, None)
            cat, conf = _parse_llm_answer(raw)
            none_score = 0.9 if cat == "NONE" else round(1.0 - conf, 4)
            return (cat, conf, none_score, None)
        except Exception as ex:
            print(f"[SEMANTIC] Ошибка инференса GigaChat: {ex} — fallback NONE", flush=True)
            return ("NONE", 0.0, 0.0, None)

    def predict(self, text: str) -> tuple[str, float]:
        """Консервативно: угроза только при score >= THRESHOLD и марже над NONE."""
        best, score, none, _ = self.explain(text)
        if best == "NONE":
            return ("NONE", score)
        if score >= SEMANTIC_THRESHOLD and score - none >= SEMANTIC_MARGIN:
            return (best, score)
        return ("NONE", score)


MODEL = SemanticModel()
