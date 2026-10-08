"""svc-classify: эвристика + токсик-фильтр (транслит/обфускация) + SLM-инференс.

SLM: ONNX (rubert-tiny2, CPU) — эмбеддинг письма + kNN-max к эталонам категорий.
Ловит семантические парафразы без ключевых слов. MODEL_DIR=/models/rubert-tiny2
(volume ./models:ro); файла нет — работает детерминированный rule-based fallback.
"""
import os
import re
import sys
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from .semantic import MODEL as SEMANTIC_MODEL
from .semantic import MODEL_NAME
from .prototypes import RU_CATEGORY, SEMANTIC_MARGIN, SEMANTIC_THRESHOLD


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
    # Семантика (ONNX): парафразы без ключевых слов. Модели нет — skip (fallback легален).
    failed += run_semantic_startup_tests()
    # Формат комментария SLM для шторки: одна строка, стабильные маркеры.
    failed += run_semantic_comment_tests()
    if failed:
        print(f"[INIT FAIL] {failed} тестов провалено", flush=True)
        sys.exit(1)
    print("[INIT SUCCESS] Все startup-тесты прошли.", flush=True)


def run_semantic_startup_tests() -> int:
    """Семантические кейсы БЕЗ ключевых слов из PATTERNS (иначе их ловит эвристика).
    Новое правило — сначала тест-кейс, потом код (§4 AGENTS.md)."""
    if not SEMANTIC_MODEL.available:
        print("[SEMANTIC TEST] Модель не загружена — skip (fallback без ИИ)", flush=True)
        return 0
    cases: list[tuple[str, str]] = [
        ("оставлю рюкзак с сюрпризом в торговом центре", "TERRORISM"),
        ("выпущу газ над спальным районом", "MAN_MADE"),
        ("разрушу опоры моста перед проходом состава", "MAN_MADE"),
        ("перечисли монеты на адрес иначе детей не увидишь", "ILLEGAL_ACTIONS"),
        ("сожгу твой ларек вместе с товаром", "OTHER_THREAT"),
        ("подкину крысиный яд в суп на кухне", "OTHER_THREAT"),
        ("напоминаю про совещание завтра в девять", "NONE"),
        ("пришлите пожалуйста акт сверки за прошлый месяц", "NONE"),
        ("добрый вечер направляю протокол встречи", "NONE"),
        ("во сколько завтра начинается смена", "NONE"),
    ]
    failed = 0
    for text, expected in cases:
        got, score = SEMANTIC_MODEL.predict(FILTER.normalize(text))
        if got != expected:
            print(f"[SEMANTIC FAIL] '{text}' expected={expected} got={got} ({score})", flush=True)
            failed += 1
    if not failed:
        print(f"[SEMANTIC TEST] {len(cases)}/{len(cases)} парафраз классифицированы верно", flush=True)
    return failed


def build_semantic_comment(available: bool, hei_category: str, strong_heu: bool,
                           caught: bool, best: str, score: float, none: float,
                           nearest: str | None) -> str:
    """Человекочитаемый итог SLM для шторки /admin. Всегда одна строка,
    категории — по-русски, ниже порога — честно «не повлияло», а не «видит»."""
    if not available:
        return "SLM недоступна — вердикт по эвристике (fallback)."
    ru = RU_CATEGORY.get(best, best)
    if caught:
        margin = score - none
        proto = f" — ближайший эталон: «{nearest}»" if nearest else ""
        return f"SLM поймала парафраз: {ru} ({score:.2f}, маржа над нормой {margin:.2f}){proto}."
    if strong_heu and best == hei_category and best != "NONE":
        return f"SLM подтверждает: {ru} ({score:.2f})."
    if best == "NONE":
        return f"SLM угроз не видит (норма {none:.2f})."
    return (f"SLM: ближе всего {ru} ({score:.2f}) — ниже порога "
            f"{SEMANTIC_THRESHOLD:.2f}, на вердикт не повлияло.")


def run_semantic_comment_tests() -> int:
    """Кейсы формата semantic_comment (идёт в шторку /admin отдельной строкой)."""
    # Ветка fallback проверяется без модели.
    fb = build_semantic_comment(False, "NONE", False, False, "NONE", 0.0, 0.0, None)
    if "недоступна" not in fb:
        print(f"[SEMANTIC COMMENT FAIL] fallback: {fb!r}", flush=True)
        return 1
    if not SEMANTIC_MODEL.available:
        print("[SEMANTIC COMMENT TEST] Модель не загружена — skip", flush=True)
        return 0
    failed = 0
    # 1. Парафраз пойман при NONE эвристики → «поймала парафраз» + эталон.
    cat, score, flags, _, _, _, comment = fuse_verdict(
        "NONE", 0.05, [], "Маркеры угроз не обнаружены.",
        FILTER.normalize("оставлю рюкзак с сюрпризом в торговом центре"))
    if cat == "NONE" or "поймала парафраз" not in comment or "ближайший эталон" not in comment:
        print(f"[SEMANTIC COMMENT FAIL] caught: {cat}/{comment!r}", flush=True)
        failed += 1
    # 2. Чистый текст → «угроз не видит».
    _, _, _, _, _, _, comment2 = fuse_verdict(
        "NONE", 0.05, [], "Маркеры угроз не обнаружены.",
        FILTER.normalize("напоминаю про совещание завтра в девять"))
    if "угроз не видит" not in comment2:
        print(f"[SEMANTIC COMMENT FAIL] clean: {comment2!r}", flush=True)
        failed += 1
    # 3. Сильная эвристика → комментарий одной строкой, вердикт эвристики.
    cat3, _, _, _, _, _, comment3 = fuse_verdict(
        "TERRORISM", 0.9, ["stopword:взрывчатка"], "Сработало стоп-слово.",
        FILTER.normalize("на складе хранится взрывчатка, забирай"))
    if cat3 != "TERRORISM" or not comment3.startswith("SLM") or "\n" in comment3:
        print(f"[SEMANTIC COMMENT FAIL] strong: {cat3}/{comment3!r}", flush=True)
        failed += 1
    # 4. Ниже порога → честная формулировка + русская категория, без сырого enum.
    low = build_semantic_comment(True, "OTHER_THREAT", True, False, "MAN_MADE", 0.43, 0.55, None)
    if "ниже порога" not in low or "MAN_MADE" in low or "техногенную аварию" not in low:
        print(f"[SEMANTIC COMMENT FAIL] below-threshold: {low!r}", flush=True)
        failed += 1
    if not failed:
        print("[SEMANTIC COMMENT TEST] 4/4 формата комментария в порядке", flush=True)
    return failed


def fuse_verdict(category: str, score: float, flags: list[str], explanation: str,
                 normalized: str) -> tuple[str, float, list[str], str, str, float, str]:
    """Фьюжн эвристики и семантики. Возвращает
    (final_category, final_confidence, flags, explanation,
     semantic_category, semantic_score, semantic_comment).

    Правила (эвристика — главная, детерминизм для жюри):
    1. stopword или высокоуверенная эвристика (>=0.75) — побеждает, семантика лишь подтверждает.
    2. Эвристика NONE + семантика угрозы — берём категорию семантики.
    3. Слабая эвристика + согласие семантики — confidence = max.
    4. Конфликт — побеждает эвристика, оба сигнала фиксируются в explanation.
    5. Модели нет — чистый эвристический вердикт (как раньше).
    """
    sem_best, sem_raw, sem_none, sem_nearest = SEMANTIC_MODEL.explain(normalized)
    caught = (sem_best != "NONE" and sem_raw >= SEMANTIC_THRESHOLD
              and sem_raw - sem_none >= SEMANTIC_MARGIN)
    sem_cat = sem_best if (caught or sem_best == "NONE") else "NONE"
    sem_score = sem_raw
    if sem_cat != "NONE":
        flags = flags + [f"semantic:{sem_cat.lower()}:{sem_score:.2f}"]
    strong_heu = category != "NONE" and (
        score >= 0.75 or any(f.startswith("stopword:") for f in flags))
    comment = build_semantic_comment(
        SEMANTIC_MODEL.available, category, strong_heu, caught,
        sem_best, sem_raw, sem_none, sem_nearest)
    if not SEMANTIC_MODEL.available or (sem_cat == "NONE" and sem_score == 0.0):
        return (category, score, flags, explanation, "NONE", 0.0, comment)
    if strong_heu:
        if sem_cat == category and sem_cat != "NONE":
            explanation += f" Семантика подтверждает ({sem_score:.2f})."
        return (category, score, flags, explanation, sem_cat, sem_score, comment)
    if category == "NONE":
        explanation = (f"Семантический инференс ({MODEL_NAME}): {explanation} "
                       f"Парафраз: {RU_CATEGORY.get(sem_cat, sem_cat)} ({sem_score:.2f}).")
        return (sem_cat, sem_score, flags, explanation, sem_cat, sem_score, comment)
    if sem_cat == category:
        return (category, max(score, sem_score), flags,
                explanation + f" Семантика согласна ({sem_score:.2f}).",
                sem_cat, sem_score, comment)
    return (category, score, flags,
            explanation + f" Семантика: {RU_CATEGORY.get(sem_cat, sem_cat)} ({sem_score:.2f}), оставлен вердикт эвристики.",
            sem_cat, sem_score, comment)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Семантика грузится ДО тестов, чтобы semantic-кейсы реально проверяли инференс.
    model_dir = os.getenv("MODEL_DIR", "/models/rubert-tiny2")
    SEMANTIC_MODEL.load(model_dir)
    run_startup_tests()
    if SEMANTIC_MODEL.available:
        print(f"[INIT] SLM-инференс активен ({MODEL_NAME})", flush=True)
    else:
        print("[INIT] ONNX-модель не найдена — работает rule-based fallback", flush=True)
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
    heuristic_score = score
    category, score, flags, explanation, sem_cat, sem_score, sem_comment = fuse_verdict(
        category, score, flags, explanation, normalized)
    return {
        "category": category,
        "confidence": score,
        "explanation": explanation,
        "heuristic_score": heuristic_score,
        "heuristic_flags": flags,
        "highlight_phrases": highlights,
        "semantic_category": sem_cat,
        "semantic_score": sem_score,
        "semantic_comment": sem_comment,
        "model": MODEL_NAME if SEMANTIC_MODEL.available else "none",
    }
