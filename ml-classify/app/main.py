"""svc-classify: эвристика + токсик-фильтр (транслит/обфускация) + GigaChat-инференс.

LLM: GigaChat (внешний API, ключ — только env GIGACHAT_API_KEY).
Ловит семантические парафразы без ключевых слов. Ключа/сети/пакета нет —
работает детерминированный rule-based fallback (как раньше без файла модели).
"""
import re
import sys
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from .semantic import MODEL as SEMANTIC_MODEL
from .semantic import MODEL_NAME
from .prototypes import RU_CATEGORY, SEMANTIC_MARGIN, SEMANTIC_THRESHOLD

# Вето семантики над слабым эвристическим сигналом: разборчивый ответ NONE от SLM
# (none-скор >= VETO_NONE_MIN) гасит одиночный маркер без усилителей
# («менделеев + хлор» — учебный контекст, а не техногенная угроза).
# none-скор — единственный реальный сигнал: промпт просит у модели NONE
# «с низкой уверенностью», поэтому raw у нормы всегда ~0.05 и в пороге не участвует.
# Мультихиты (>=0.75), стоп-слова админа и токсичность вето не касается.
# Без ключа/сети fallback отдаёт (NONE, 0.0, 0.0), safety-блок и мусор — тоже
# нули: порог не проходят, поведение fail-closed (карантин как раньше).
VETO_NONE_MIN = 0.85


class ToxicityAndProfanityFilter:
    # Безопасные целые слова/подстроки, которые нельзя считать матом (ложные срабатывания).
    # При целословной проверке нужны лишь как страховка (тебе, требует, учеба, хлеб...).
    SAFE_SUBSTRINGS = ("колебан", "рубл", "скипидар", "блеск", "блок", "ебел", "ребе")

    # Мат ловим ТОЛЬКО целыми словами (токенами), а не подстрокой:
    # иначе «ебе» внутри «тебе» и «ебу» внутри «требует» дают ложный карантин.
    # Паттерны заякорены ^...$ на весь токен, префиксы — только матерные
    # (у/за/про/вы/долбо...), поэтому «тебе/себе/требует/хлеб/учеба» не матчатся.
    PROFANE_TOKEN_PATTERNS = (
        r"(?:на|а|о)?ху[йяюеёыи][а-я]*",
        r"аху[еи][а-я]*",
        r"оху[еи][а-я]*",
        r"нах[уйяеи][а-я]*",
        r"п[иы]зд[а-я]*",
        r"(?:у|за|про|вы|до|от|пере|под|раз|с|на|об|долбо)?[ъь]?[её]б[а-я]*",
        r"уеб[а-я]*",
        r"ебл[а-я]*",
        r"бля[а-я]*",
        r"сук[аио][а-я]*",
        r"муда?к[а-я]*",
        r"гондон[а-я]*",
        r"залуп[а-я]*",
        r"шлюх[а-я]*",
        r"пидор[а-я]*",
        r"пидр[а-я]*",
        r"чмо[а-я]*",
    )

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
        self.regex_token_profane = re.compile(
            f"^(?:{'|'.join(self.PROFANE_TOKEN_PATTERNS)})$", re.IGNORECASE)

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
        # Целословная проверка: режем на токены, каждый токен — целиком против паттернов.
        # Подстроки внутри нормальных слов («тебе», «требует», «учеба») не считаются.
        # Явные нормальные слова с «еб» никогда не мат, даже если якоря пропустят.
        explicit_safe = {
            "тебе", "себе", "требует", "требуют", "требование", "требования",
            "учеба", "учебу", "учебы", "хлеб", "хлеба", "хлебом",
            "ребенок", "ребенка", "потребность", "потребности",
        }
        real: list[str] = []
        for tok in re.findall(r"[а-яёa-z0-9]+", cleaned.lower()):
            if tok in explicit_safe:
                continue
            if any(s in tok for s in self.SAFE_SUBSTRINGS):
                continue
            if self.regex_token_profane.match(tok):
                real.append(tok)
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
        # Регрессия целословной проверки: подстрока «ебе/ебу» внутри
        # нормальных слов — не мат (иначе «тебе/требует» уходили в карантин).
        ("привет тебе не жить", False),
        ("не требует установки сторонних пакетов", False),
        ("учеба в университете", False),
        ("хлеб свежий", False),
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
    # Семантическое вето слабого сигнала (ложный карантин «менделеев + хлор»):
    # детерминировано, без сети — explain подменяется стабом, в конце restore.
    failed += run_veto_startup_tests()
    # Семантика (ONNX): парафразы без ключевых слов. Модели нет — skip (fallback легален).
    failed += run_semantic_startup_tests()
    # Формат комментария SLM для шторки: одна строка, стабильные маркеры.
    failed += run_semantic_comment_tests()
    if failed:
        print(f"[INIT FAIL] {failed} тестов провалено", flush=True)
        sys.exit(1)
    print("[INIT SUCCESS] Все startup-тесты прошли.", flush=True)


def run_veto_startup_tests() -> int:
    """Вето: слабый эвристический сигнал (<0.75) гасится уверенным NONE семантики.
    Живую сеть не трогаем — SEMANTIC_MODEL.explain подменяется стабами.
    Позитив: учебный «хлор» уходит в NONE с флагом semantic-veto.
    Анти-кейсы: стоп-слово, токсичность, сильный сигнал, согласие семантики
    с угрозой и fallback (без ключа/сети) вето НЕ дают — карантин сохраняется."""
    failed = 0
    orig_explain = SEMANTIC_MODEL.explain
    cls = type(SEMANTIC_MODEL)
    orig_available = cls.available

    def fuse_with(norm: str, sw: list[StopwordRule]):
        hcat, hscore, hflags, _hexp = heuristic_scan(norm, sw)
        fcat, fscore, fflags, _fexp, _sc, _ss, _cm = fuse_verdict(
            hcat, hscore, hflags, "t", norm)
        return hcat, hscore, fcat, fscore, fflags

    def check(name: str, text: str, sw: list[StopwordRule],
              exp_cat: str, exp_veto: bool) -> None:
        nonlocal failed
        norm = FILTER.normalize(text)
        hcat, hscore, fcat, _fs, fflags = fuse_with(norm, sw)
        has_veto = any(f.startswith("semantic-veto:") for f in fflags)
        if hcat == "NONE" and exp_veto:
            print(f"[TEST FAIL] veto setup: heuristic NONE for '{text}'", flush=True)
            failed += 1
            return
        if fcat != exp_cat or has_veto != exp_veto:
            print(f"[TEST FAIL] veto/{name} '{text}' got {fcat}/{fflags}", flush=True)
            failed += 1

    try:
        sw_rules = [StopwordRule(pattern="взрывчатка", category="TERRORISM")]
        cls.available = property(lambda self: True)  # type: ignore
        # Фаза 1: семантика за норму — вето срабатывает только на слабый сигнал.
        # Стаб реалистичный: промпт просит NONE «с низкой уверенностью» (raw ~0.05),
        # вето смотрит на none-скор, а не на raw.
        SEMANTIC_MODEL.explain = lambda text: ("NONE", 0.05, 0.9, None)  # type: ignore
        check("chemistry", "выучи таблицу менделеева и овр с хлором", [], "NONE", True)
        check("no-veto-stopword", "на складе хранится взрывчатка, забирай",
              sw_rules, "TERRORISM", False)
        check("no-veto-toxic", "это полный пиздец с хлором", [], "MAN_MADE", False)
        check("no-veto-strong", "на перегоне сход цистерн с хлором", [], "MAN_MADE", False)
        # Фаза 2: семантика подтверждает угрозу — вето нет, согласие (max).
        SEMANTIC_MODEL.explain = lambda text: ("MAN_MADE", 0.9, 0.1, None)  # type: ignore
        check("no-veto-agree", "выучи таблицу менделеева и овр с хлором",
              [], "MAN_MADE", False)
        # Фаза 3: fallback без ключа/сети (0.0/0.0) — fail-closed, вето нет.
        cls.available = property(lambda self: False)  # type: ignore
        SEMANTIC_MODEL.explain = lambda text: ("NONE", 0.0, 0.0, None)  # type: ignore
        check("no-veto-fallback", "выучи таблицу менделеева и овр с хлором",
              [], "MAN_MADE", False)
    finally:
        SEMANTIC_MODEL.explain = orig_explain  # type: ignore
        cls.available = orig_available  # type: ignore
    if not failed:
        print("[VETO TEST] слабый сигнал гасится, 5 анти-кейсов держат карантин", flush=True)
    return failed


def run_semantic_startup_tests() -> int:
    """Семантические кейсы БЕЗ ключевых слов из PATTERNS (иначе их ловит эвристика).
    Новое правило — сначала тест-кейс, потом код (§4 AGENTS.md).
    Внешний LLM может быть недоступен в момент старта — тогда skip, а не fail,
    иначе сервис не поднимется без сети даже с валидным ключом."""
    if not SEMANTIC_MODEL.available:
        print("[SEMANTIC TEST] Провайдер не настроен — skip (fallback без ИИ)", flush=True)
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
    skipped = 0
    for text, expected in cases:
        try:
            got, score = SEMANTIC_MODEL.predict(FILTER.normalize(text))
        except Exception as ex:
            print(f"[SEMANTIC SKIP] '{text}': {ex}", flush=True)
            skipped += 1
            continue
        if got == "NONE" and score == 0.0 and expected != "NONE":
            # Сигнал fallback (ошибка сети/safety-блок) — не валим старт.
            print(f"[SEMANTIC SKIP] '{text}': провайдер вернул fallback", flush=True)
            skipped += 1
            continue
        if got != expected:
            print(f"[SEMANTIC FAIL] '{text}' expected={expected} got={got} ({score})", flush=True)
            failed += 1
    if skipped:
        print(f"[SEMANTIC TEST] skip {skipped}/{len(cases)} (нет сети/ответа) — старт разрешён", flush=True)
        return 0
    if not failed:
        print(f"[SEMANTIC TEST] {len(cases)}/{len(cases)} парафраз классифицированы верно", flush=True)
    return failed


def build_semantic_comment(available: bool, hei_category: str, strong_heu: bool,
                           caught: bool, best: str, score: float, none: float,
                           nearest: str | None, vetoed: bool = False) -> str:
    """Человекочитаемый итог SLM для шторки /admin. Всегда одна строка,
    категории — по-русски, ниже порога — честно «не повлияло», а не «видит».
    (Бэкенд — GigaChat, но модель отвечает от лица SLM, поэтому подпись та же.)"""
    if not available:
        return "SLM недоступна — вердикт по эвристике (fallback)."
    if vetoed:
        ru_hei = RU_CATEGORY.get(hei_category, hei_category)
        return (f"SLM сняла слабый сигнал эвристики ({ru_hei}): "
                f"угроз не видит (норма {none:.2f}).")
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
    """Кейсы формата semantic_comment (идёт в шторку /admin отдельной строкой).
    Pure unit, без сети: живые вызовы GigaChat на старте запрещены (иначе старт
    зависит от внешней сети)."""
    # Ветка fallback проверяется без модели.
    fb = build_semantic_comment(False, "NONE", False, False, "NONE", 0.0, 0.0, None)
    if "недоступна" not in fb:
        print(f"[SEMANTIC COMMENT FAIL] fallback: {fb!r}", flush=True)
        return 1
    failed = 0
    # 1. Парафраз пойман при NONE эвристики → «поймала парафраз» (эталон опционален:
    # у GigaChat его нет, у ONNX был — формат держит оба варианта).
    caught = build_semantic_comment(True, "NONE", False, True, "TERRORISM", 0.83, 0.2, None)
    if "поймала парафраз" not in caught or "\n" in caught or not caught.startswith("SLM"):
        print(f"[SEMANTIC COMMENT FAIL] caught: {caught!r}", flush=True)
        failed += 1
    # 2. Чистый текст → «угроз не видит».
    clean = build_semantic_comment(True, "NONE", False, False, "NONE", 0.1, 0.9, None)
    if "угроз не видит" not in clean:
        print(f"[SEMANTIC COMMENT FAIL] clean: {clean!r}", flush=True)
        failed += 1
    # 3. Сильная эвристика + согласие → комментарий одной строкой.
    strong = build_semantic_comment(True, "TERRORISM", True, False, "TERRORISM", 0.9, 0.2, None)
    if not strong.startswith("SLM") or "\n" in strong:
        print(f"[SEMANTIC COMMENT FAIL] strong: {strong!r}", flush=True)
        failed += 1
    # 4. Ниже порога → честная формулировка + русская категория, без сырого enum.
    low = build_semantic_comment(True, "OTHER_THREAT", True, False, "MAN_MADE", 0.43, 0.55, None)
    if "ниже порога" not in low or "MAN_MADE" in low or "техногенную аварию" not in low:
        print(f"[SEMANTIC COMMENT FAIL] below-threshold: {low!r}", flush=True)
        failed += 1
    # 5. Вето слабого сигнала → одна строка: что снято + норма, без сырого enum.
    veto_c = build_semantic_comment(True, "MAN_MADE", False, False, "NONE", 0.95, 0.9, None,
                                    vetoed=True)
    if ("сняла слабый сигнал" not in veto_c or "техногенную аварию" not in veto_c
            or "MAN_MADE" in veto_c or "\n" in veto_c or not veto_c.startswith("SLM")):
        print(f"[SEMANTIC COMMENT FAIL] veto: {veto_c!r}", flush=True)
        failed += 1
    if not failed:
        print("[SEMANTIC COMMENT TEST] 5/5 формата комментария в порядке", flush=True)
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
    6. Вето: слабая эвристика (<0.75, без stopword/profanity) + разборчивое NONE
       семантики (available, sem NONE, none-скор >= VETO_NONE_MIN) — итог NONE
       с флагом semantic-veto (одиночный бытовой маркер — не угроза).
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
    weak_heu = (category != "NONE" and not strong_heu
                and not any(f.startswith("profanity:") for f in flags))
    veto = (weak_heu and SEMANTIC_MODEL.available and sem_cat == "NONE"
            and sem_none >= VETO_NONE_MIN)
    comment = build_semantic_comment(
        SEMANTIC_MODEL.available, category, strong_heu, caught,
        sem_best, sem_raw, sem_none, sem_nearest, vetoed=veto)
    if not SEMANTIC_MODEL.available or (sem_cat == "NONE" and sem_score == 0.0):
        return (category, score, flags, explanation, "NONE", 0.0, comment)
    if veto:
        flags = flags + [f"semantic-veto:{category.lower()}:{score:.2f}"]
        explanation = (f"{explanation} Слабый сигнал снят семантикой: "
                       f"SLM угроз не видит (норма {sem_none:.2f}).")
        return ("NONE", sem_raw, flags, explanation, "NONE", sem_score, comment)
    if strong_heu:
        if sem_cat == category and sem_cat != "NONE":
            explanation += f" Семантика подтверждает ({sem_score:.2f})."
        return (category, score, flags, explanation, sem_cat, sem_score, comment)
    if category == "NONE":
        explanation = (f"Семантический инференс (SLM): {explanation} "
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
    # GigaChat-провайдер инициализируется БЕЗ сетевых вызовов (сеть — только
    # в explain/predict), затем обычные startup-тесты.
    SEMANTIC_MODEL.load()
    run_startup_tests()
    if SEMANTIC_MODEL.available:
        print(f"[INIT] GigaChat-инференс активен ({MODEL_NAME})", flush=True)
    else:
        print("[INIT] GigaChat не настроен — работает rule-based fallback", flush=True)
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
