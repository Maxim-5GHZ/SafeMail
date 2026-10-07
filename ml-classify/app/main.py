"""svc-classify: эвристика + токсик-фильтр (транслит/обфускация) + SLM-х hook.

SLM: если в MODEL_PATH лежит GGUF (Qwen2.5-1.5B Q4), можно подключить llama-cpp-python.
В MVP работает детерминированный rule-based fallback — его и покрывают startup-тесты.
"""
import os
import re
import sys
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel


class ToxicityAndProfanityFilter:
    # Безопасные подстроки, которые нельзя считать матом (ложные срабатывания)
    SAFE_SUBSTRINGS = ("колебан", "рубл", "скипидар", "блеск", "блок", "ебел", "ребе")

    def __init__(self) -> None:
        self.char_map = {
            'a': 'а', '@': 'а', 'b': 'б', '6': 'б', 'v': 'в', 'w': 'в',
            'g': 'г', 'd': 'д', 'e': 'е', 'ye': 'е', 'yo': 'ё', 'zh': 'ж',
            'z': 'з', '3': 'з', 'i': 'и', '1': 'и', '!': 'и',
            'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', '0': 'о',
            'p': 'п', 'r': 'р', 's': 'с', '$': 'с', 't': 'т', 'u': 'у',
            'f': 'ф', 'h': 'х', 'x': 'х', 'c': 'ц', 'ch': 'ч',
            '4': 'ч', 'sh': 'ш', 'y': 'й', 'j': 'й', 'yu': 'ю', 'ya': 'я',
        }
        self.profane_roots = [
            r"ху[йеяиюеёы]", r"наху", r"нах[уйы]", r"аху[уйы]", r"пизд", r"п[иы]здец",
            r"еб[аеёиуал]", r"бля", r"сук[аио]", r"муда?к", r"гондон", r"уеб",
            r"залуп", r"шлюх", r"пидор", r"чмо",
        ]
        self.regex_profane = re.compile(f"({'|'.join(self.profane_roots)})", re.IGNORECASE)

    def normalize(self, text: str) -> str:
        t = text.lower()
        # Склеиваем только мусорные разделители ВНУТРИ слов (s*u*k*a, п.и.з.д),
        # обычные пробелы между словами сохраняем.
        t = re.sub(r"([a-zа-я0-9])[\.\-_ʼ\*\+]+([a-zа-я0-9])", r"\1\2", t)
        t = re.sub(r"([a-zа-я0-9])[\.\-_ʼ\*\+]+([a-zа-я0-9])", r"\1\2", t)
        t = re.sub(r"(.)\1{2,}", r"\1", t)
        out: list[str] = []
        i = 0
        while i < len(t):
            if i + 1 < len(t) and t[i:i + 2] in self.char_map:
                out.append(self.char_map[t[i:i + 2]])
                i += 2
            elif t[i] in self.char_map:
                out.append(self.char_map[t[i]])
                i += 1
            else:
                out.append(t[i])
                i += 1
        return "".join(out)

    def analyze(self, text: str) -> tuple[bool, list[str], str]:
        cleaned = self.normalize(text)
        matches = [m for m in self.regex_profane.findall(cleaned)
                   if not any(safe in m.lower() for safe in ("колебан",))]
        # Отсекаем совпадения внутри безопасных слов
        real: list[str] = []
        for m in matches:
            low = cleaned.lower()
            idx = low.find(m.lower())
            window = low[max(0, idx - 6):idx + len(m) + 6]
            if any(s in window for s in self.SAFE_SUBSTRINGS):
                continue
            real.append(m)
        return (len(real) > 0, sorted(set(real)), cleaned)


FILTER = ToxicityAndProfanityFilter()

# Эвристические паттерны по 4 категориям ТЗ
PATTERNS: dict[str, list[str]] = {
    "TERRORISM": [r"теракт", r"террор", r"взорв", r"бомб", r"заложник", r"джихад", r"смертник"],
    "MAN_MADE": [r"аэс", r"плотин", r"дамб", r"ж/д", r"перегон", r"цистерн", r"хлор", r"аммиак",
                 r"диверси", r"сход\s+вагон", r"авари"],
    "ILLEGAL_ACTIONS": [r"убью", r"расправ", r"шантаж", r"биткоин", r"битк", r"выкуп",
                        r"поплатишься", r"семь[ею].*п[иы]здец", r"переведи.*деньг"],
    "OTHER_THREAT": [r"угроза", r"поджог", r"отрав", r"заминир", r"нападен"],
}


class StopwordRule(BaseModel):
    """Управляемое стоп-слово из PG (админка /admin): подстрока -> категория."""
    pattern: str = ""
    category: str = "OTHER_THREAT"


class ClassifyRequest(BaseModel):
    text: str = ""
    stopwords: list[StopwordRule] = []


def stopword_scan(normalized: str, stopwords: list[StopwordRule]) -> tuple[str, float, list[str], list[str]] | None:
    """Подстрока без учёта регистра по нормализованному тексту (обфускация уже снята).
    Первое совпадение побеждает; неизвестная/NONE-категория маппится в OTHER_THREAT."""
    low = normalized.lower()
    for rule in stopwords:
        pat = (rule.pattern or "").strip()
        if len(pat) < 2:
            continue
        idx = low.find(pat.lower())
        if idx < 0:
            continue
        cat = (rule.category or "").strip().upper()
        if cat not in PATTERNS:
            cat = "OTHER_THREAT"
        s = max(0, idx - 20)
        snippet = normalized[s:idx + len(pat) + 20].strip()
        return (cat, 0.9, [f"stopword:{pat}"], [snippet] if snippet else [normalized[:120]])
    return None


def heuristic_scan(normalized: str, stopwords: list[StopwordRule] | None = None) -> tuple[str, float, list[str], list[str]]:
    flags: list[str] = []
    hits: dict[str, int] = {}
    highlights: list[str] = []
    # Управляемые стоп-слова — первым приоритетом (детерминированный сигнал из PG).
    sw_hit = stopword_scan(normalized, stopwords or [])
    if sw_hit is not None:
        return sw_hit
    for cat, pats in PATTERNS.items():
        for p in pats:
            for m in re.finditer(p, normalized, re.IGNORECASE):
                flags.append(f"{cat.lower()}:{p}")
                hits[cat] = hits.get(cat, 0) + 1
                s = max(0, m.start() - 20)
                highlights.append(normalized[s:m.end() + 20].strip())
    toxic, prof, _ = FILTER.analyze(normalized)
    if toxic:
        flags.extend(f"profanity:{w}" for w in prof)
    if not hits:
        # Направленная токсичность (мат/оскорбления) сама по себе — OTHER_THREAT:
        # иначе «иди нахуй…» в теме при пустом теле уходит DELIVERED.
        if toxic:
            return ("OTHER_THREAT", 0.75, flags, highlights[:5] or [normalized[:120]])
        return ("NONE", 0.05, flags, highlights[:5])
    best = max(hits, key=lambda k: hits[k])
    score = min(0.55 + 0.15 * hits[best] + (0.1 if toxic else 0.0), 0.98)
    # Мат сам по себе без угроз — не угроза по ТЗ, а OTHER только при контексте угрозы
    if best == "ILLEGAL_ACTIONS" or toxic:
        pass
    return (best, round(score, 4), flags, highlights[:5])


def run_startup_tests() -> None:
    print("[INIT] Self-check фильтра мата/транслита и эвристики...", flush=True)
    cases: list[tuple[str, bool]] = [
        ("Добрый день, высылаю отчет по проекту.", False),
        ("Колебания курса рубля не влияют на сделку.", False),
        ("Ты тупая s*u*k*a и получишь по заслугам", True),
        ("naxyi idi otsuda", True),
        ("Уе6ок, я тебя найду", True),
        ("p!zdec polniy proiskhodit", True),
        ("Срочно оплатите счет во вложении", False),
    ]
    failed = 0
    for text, expected in cases:
        toxic, _, norm = FILTER.analyze(text)
        if toxic != expected:
            print(f"[TEST FAIL] '{text}' expected={expected} norm='{norm}'", flush=True)
            failed += 1
    # Категории
    cat, _, _, _ = heuristic_scan(FILTER.normalize("Мы заложили бомбу на вокзале"))
    if cat != "TERRORISM":
        print(f"[TEST FAIL] terrorism category got {cat}", flush=True)
        failed += 1
    cat2, _, _, _ = heuristic_scan(FILTER.normalize("На перегоне сход цистерн с хлором"))
    if cat2 != "MAN_MADE":
        print(f"[TEST FAIL] man_made category got {cat2}", flush=True)
        failed += 1
    # Чистый мат без контекста угрозы — тоже блокируем как OTHER_THREAT
    # (регрессия: «иди нахуй…» в теме при пустом теле уходило DELIVERED).
    cat3, _, flags3, _ = heuristic_scan(FILTER.normalize("иди нахуй сын шлюхи"))
    if cat3 != "OTHER_THREAT":
        print(f"[TEST FAIL] profanity category got {cat3}", flush=True)
        failed += 1
    if not any(f.startswith("profanity:") for f in flags3):
        print("[TEST FAIL] profanity flags missing", flush=True)
        failed += 1
    # Управляемые стоп-слова: прямой/транслит/обфускация/false-positive/пустой список
    sw = [StopwordRule(pattern="взрывчатка", category="TERRORISM"),
          StopwordRule(pattern="обнал", category="ILLEGAL_ACTIONS")]
    cat_sw, score_sw, flags_sw, _ = heuristic_scan(
        FILTER.normalize("На складе хранится взрывчатка, забирай"), sw)
    if cat_sw != "TERRORISM" or score_sw < 0.9 or "stopword:взрывчатка" not in flags_sw:
        print(f"[TEST FAIL] stopword direct got {cat_sw}/{score_sw}/{flags_sw}", flush=True)
        failed += 1
    cat_tr, _, flags_tr, _ = heuristic_scan(
        FILTER.normalize("predlagayu obnal deneg srochno"), sw)
    if cat_tr != "ILLEGAL_ACTIONS" or "stopword:обнал" not in flags_tr:
        print(f"[TEST FAIL] stopword translit got {cat_tr}/{flags_tr}", flush=True)
        failed += 1
    cat_ob, _, flags_ob, _ = heuristic_scan(FILTER.normalize("нужен о.б.н.а.л наличкой"), sw)
    if cat_ob != "ILLEGAL_ACTIONS" or "stopword:обнал" not in flags_ob:
        print(f"[TEST FAIL] stopword obfuscation got {cat_ob}/{flags_ob}", flush=True)
        failed += 1
    cat_fp, _, flags_fp, _ = heuristic_scan(FILTER.normalize("Обсудим наличные платежи завтра"), sw)
    if cat_fp != "NONE" or any(f.startswith("stopword:") for f in flags_fp):
        print(f"[TEST FAIL] stopword false-positive got {cat_fp}/{flags_fp}", flush=True)
        failed += 1
    cat_empty, _, _, _ = heuristic_scan(FILTER.normalize("Мы заложили бомбу на вокзале"), [])
    if cat_empty != "TERRORISM":
        print(f"[TEST FAIL] empty stopwords changed behavior: {cat_empty}", flush=True)
        failed += 1
    if failed:
        print(f"[INIT FAIL] {failed} тестов провалено", flush=True)
        sys.exit(1)
    print("[INIT SUCCESS] Все startup-тесты прошли.", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_startup_tests()
    model_path = os.getenv("MODEL_PATH", "")
    if model_path and os.path.exists(model_path):
        print(f"[INIT] Найдена SLM-модель {model_path}, включаем llama.cpp hook (TODO: инференс)", flush=True)
    else:
        print("[INIT] GGUF-модель не найдена — работает rule-based fallback", flush=True)
    yield


app = FastAPI(title="safemail-classify", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "classify"}


@app.post("/internal/classify-threat")
def classify_threat(req: ClassifyRequest) -> dict[str, Any]:
    text = req.text or ""
    normalized = FILTER.normalize(text)
    category, score, flags, highlights = heuristic_scan(normalized, req.stopwords or [])
    # heuristic_scan уже маппит чистый мат в OTHER_THREAT — здесь только объяснения.
    explanations = {
        "NONE": "Маркеры угроз не обнаружены.",
        "TERRORISM": "Обнаружены маркеры угрозы террористического характера.",
        "MAN_MADE": "Обнаружены маркеры угрозы техногенной аварии.",
        "ILLEGAL_ACTIONS": "Обнаружены маркеры шантажа/расправы/противоправных действий.",
        "OTHER_THREAT": "Обнаружены маркеры иных угроз.",
    }
    explanation = explanations.get(category, "")
    sw_flag = next((f for f in flags if f.startswith("stopword:")), None)
    if sw_flag is not None:
        explanation = f"Сработало управляемое стоп-слово «{sw_flag.split(':', 1)[1]}»."
    return {
        "category": category,
        "confidence": score,
        "explanation": explanation,
        "heuristic_score": score,
        "heuristic_flags": flags,
        "highlight_phrases": highlights,
    }
