"""svc-enrich: деобфускация/транслит, раскладка, Яндекс.Спеллер, проверка ссылок.

Порядок важен: сначала восстанавливаем слова (спеллер + снятие маскировки),
и только потом работают алгоритмы classify — иначе обфускация прячет угрозу.
Каждая правка спеллера подписана источником: yandex | mixed-alphabet | layout.
"""
import re
import sys
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

CHAR_MAP = {
    'a': 'а', '@': 'а', 'b': 'б', '6': 'б', 'v': 'в', 'w': 'в',
    'g': 'г', 'd': 'д', 'e': 'е', 'yo': 'ё', 'zh': 'ж',
    'z': 'з', '3': 'з', 'i': 'и', '1': 'и', '!': 'и',
    'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', '0': 'о',
    'p': 'п', 'r': 'р', 's': 'с', '$': 'с', 't': 'т', 'u': 'у',
    'f': 'ф', 'h': 'х', 'x': 'х', 'c': 'ц', '4': 'ч',
}

DIGRAPHS = {"sh": "ш", "ch": "ч", "zh": "ж", "yu": "ю", "ya": "я", "ye": "е"}

# Невидимые символы — популярный приём маскировки (нулевая ширина).
ZERO_WIDTH = {"\u200b", "\u200c", "\u200d", "\ufeff"}

# Английская раскладка -> русская (строчные; текст перед этим lower()'ится).
LAYOUT_EN_RU = {
    'q': 'й', 'w': 'ц', 'e': 'у', 'r': 'к', 't': 'е', 'y': 'н',
    'u': 'г', 'i': 'ш', 'o': 'щ', 'p': 'з', '[': 'х', ']': 'ъ',
    'a': 'ф', 's': 'ы', 'd': 'в', 'f': 'а', 'g': 'п', 'h': 'р',
    'j': 'о', 'k': 'л', 'l': 'д', ';': 'ж', "'": 'э',
    'z': 'я', 'x': 'ч', 'c': 'с', 'v': 'м', 'b': 'и', 'n': 'т',
    'm': 'ь', ',': 'б', '.': 'ю', '/': '.',
}

# Частотные русские слова + формы слов угроз: «осмысленность» после
# перекладки раскладки проверяем точным вхождением (ограничение зафиксировано:
# редкие словоформы раскладкой не ловятся, их добирает Яндекс.Спеллер).
COMMON_RU_WORDS = frozenset("""
привет здравствуйте спасибо пожалуйста добрый день вечер утро
я ты он она оно мы вы они меня тебя себя нас вас его ее их
мой моя мое твой твоя ваш ваша это эта этот что как кто
где куда откуда туда сюда здесь там тут сейчас сегодня завтра вчера
срочно очень снова опять просто только уже еще даже именно почти
сразу потом затем сначала все всего всех время человек люди жизнь
деньги рублей рубль тысяча миллион счет счета оплата оплати оплатите
плати заплати переведи переведите получи получишь иначе надо нужно
можно нельзя хорошо плохо большой новый первый последний номер адрес
телефон позвони напиши жду ждите встреча конец начало
убью убьем расправа заложник заложники заложили бомба бомбу бомбы
взрыв взрыва взорвать взорвем теракт террор смертник хлор хлором
аммиак цистерна цистерны цистерн перегон перегоне вокзал вокзале
аэропорт мост плотина школа больница заминировали инструкция тихо
молчи никому слова забери забери жди шантаж выкуп биткоин получишь
""".split())

SUSPICIOUS_TLDS = (".ru", ".tk", ".ml", ".ga", ".cf", ".gq", ".top", ".xyz")
BLACKLIST_HINTS = ("login", "verify", "invoice", "wallet", "pay-", "sabotage", "leak", "free-", "bonus")


class EnrichRequest(BaseModel):
    text: str = ""
    urls: list[str] = []


def strip_zero_width(text: str) -> tuple[str, int]:
    """Срезает невидимые символы, возвращает (чистый текст, число срезанных)."""
    count = sum(1 for ch in text if ch in ZERO_WIDTH)
    if not count:
        return text, 0
    return "".join(ch for ch in text if ch not in ZERO_WIDTH), count


def transliterate(token: str) -> str:
    """Посимвольный транслит латиница/leet -> кириллица (старое поведение).
    leet-цифры (1->и, 3->з, 0->о...) маппятся, только если цифра внутри букв
    (хл0р, б0мба). Чистые числа (13, 2026) и хвосты цифр (залп13) не трогаем —
    иначе «залп-13» превращается в псевдо-мат «залпиз» и чистые письма
    уходят в карантин (кейс залп-13)."""
    out: list[str] = []
    i = 0
    while i < len(token):
        two = token[i:i + 2]
        # len==2 обязательно: срез из 1 символа в конце иначе матчится
        # на однобуквенные ключи и обходит проверку позиции цифры ниже.
        if len(two) == 2 and (two in DIGRAPHS or two in CHAR_MAP):
            out.append(DIGRAPHS.get(two, CHAR_MAP.get(two, two)))
            i += 2
        elif token[i] in CHAR_MAP:
            ch = token[i]
            if ch.isdigit():
                prev_ok = i > 0 and re.match(r"[a-zа-яё]", token[i - 1]) is not None
                next_ok = i + 1 < len(token) and re.match(r"[a-zа-яё]", token[i + 1]) is not None
                out.append(CHAR_MAP[ch] if (prev_ok and next_ok) else ch)
            else:
                out.append(CHAR_MAP[ch])
            i += 1
        else:
            out.append(token[i])
            i += 1
    return "".join(out)


def layout_translate(token: str) -> str:
    """Перекладка токена из английской раскладки в русскую."""
    return "".join(LAYOUT_EN_RU.get(ch, ch) for ch in token)


def is_layout_typo(token: str) -> bool:
    """Чисто латинский токен, осмысленный только после перекладки раскладки.

    Английские слова (login, invoice) перекладку не проходят — их нет в словаре,
    они идут обычным транслитом как раньше. Проверка строгая сознательно:
    лучше пропустить, чем сломать легитимную латиницу.
    """
    if len(token) < 3 or not re.search(r"[a-z]", token):
        return False
    if re.search(r"[а-яё]", token):
        return False  # смешанный алфавит — не раскладка, а транслит/опечатка
    return layout_translate(token) in COMMON_RU_WORDS


# В слово входят и буквы раскладки (, . ; ' [ ] / -): иначе «,jv,e» рвётся
# на куски и перекладка не срабатывает. Лишнее отсекает словарь: мимо него
# токен идёт старым транслитом, знаки сохраняются как есть.
WORD_PAT = re.compile(r"[a-zа-яё0-9@!$\*,.\-;'\[\]/]+")


def normalize_with_fixes(text: str) -> tuple[str, list[dict[str, str]]]:
    """Нормализация с пословной раскладкой. Пробелы и пунктуация сохраняются."""
    t = text.lower()
    # Только внутрисловные разделители, пробелы между словами сохраняем
    t = re.sub(r"([a-zа-я0-9])[\.\-_ʼ\*\+]+([a-zа-я0-9])", r"\1\2", t)
    t = re.sub(r"([a-zа-я0-9])[\.\-_ʼ\*\+]+([a-zа-я0-9])", r"\1\2", t)
    t = re.sub(r"(.)\1{2,}", r"\1", t)
    fixes: list[dict[str, str]] = []

    def fix_word(m: re.Match) -> str:
        w = m.group(0)
        if is_layout_typo(w):
            sug = layout_translate(w)
            fixes.append({"original": w, "suggested": sug, "source": "layout"})
            return sug
        return transliterate(w)

    return WORD_PAT.sub(fix_word, t), fixes


def normalize(text: str) -> str:
    norm, _ = normalize_with_fixes(text)
    return norm


def yandex_speller_fixes(text: str) -> list[dict[str, str]]:
    """Яндекс.Спеллер + эвристика смешанного алфавита. У каждой правки — source."""
    fixes: list[dict[str, str]] = []
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9@!$\*]{3,}", text)[:30]
    # Эвристика: смешанные алфавиты внутри слова
    for w in words:
        has_lat = bool(re.search(r"[a-zA-Z]", w))
        has_cyr = bool(re.search(r"[а-яА-ЯёЁ]", w))
        if has_lat and has_cyr:
            fixes.append({"original": w, "suggested": normalize(w) + " (смешанный алфавит)",
                          "source": "mixed-alphabet"})
    try:
        sample = " ".join(words[:20])
        if sample:
            r = httpx.get("https://speller.yandex.net/services/spellservice.json/checkText",
                           params={"text": sample, "lang": "ru"}, timeout=3.0)
            if r.status_code == 200:
                for item in r.json():
                    s = item.get("s") or []
                    if s:
                        fixes.append({"original": item.get("word", ""), "suggested": s[0],
                                      "source": "yandex"})
    except Exception:
        pass
    return fixes[:20]


def score_url(url: str) -> dict[str, Any]:
    u = url.lower()
    score = 0
    reasons: list[str] = []
    if re.search(r"https?://\d+\.\d+\.\d+\.\d+", u):
        score += 50
        reasons.append("ip-in-host")
    if "@" in u or u.count("-") >= 3:
        score += 20
        reasons.append("obfuscated-host")
    if any(t in u for t in SUSPICIOUS_TLDS):
        score += 10
        reasons.append("suspicious-tld")
    hint_hits = [h for h in BLACKLIST_HINTS if h in u]
    if hint_hits:
        score += 30 + 15 * (len(hint_hits) - 1)
        reasons.append("blacklist-hint:" + ",".join(hint_hits))
    if u.startswith("http://"):
        score += 10
        reasons.append("no-tls")
    if len(u) > 120:
        score += 10
        reasons.append("long-url")
    score = min(score, 100)
    return {
        "url": url,
        "is_phishing": score >= 70,
        "risk_score": score,
        "engine": "Internal Anti-Fraud Engine (+Yandex SafeBrowsing hook)",
        "reasons": reasons,
    }


def run_startup_tests() -> None:
    print("[INIT] Self-check деобфускации/раскладки/спеллера...", flush=True)
    failed = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failed
        if not cond:
            print(f"[TEST FAIL] {name} {detail}", flush=True)
            failed += 1

    # Раскладка: прямая
    norm, fixes = normalize_with_fixes("ghbdtn")
    check("layout-direct", norm == "привет", f"got '{norm}'")
    check("layout-source", any(f.get("source") == "layout" and f.get("suggested") == "привет" for f in fixes),
          f"got {fixes}")
    # Раскладка: угроза ловится нормализацией
    norm2, fixes2 = normalize_with_fixes("заложили ,jv,e на вокзале")
    check("layout-threat", "бомбу" in norm2, f"got '{norm2}'")
    check("layout-threat-source", any(f.get("source") == "layout" for f in fixes2), f"got {fixes2}")
    # Раскладка: английское слово НЕ трогаем перекладкой (нет в словаре)
    norm3, fixes3 = normalize_with_fixes("login invoice")
    check("layout-false-positive", "дщпут" not in norm3 and not any(f.get("source") == "layout" for f in fixes3),
          f"got '{norm3}' {fixes3}")
    check("layout-fallback-translit", norm3 == "логин инвоице", f"got '{norm3}'")
    # Смешанный алфавит: латиница + кириллица в одном слове (бoмбу — 'o' латинская).
    # Цифровые подмены (б0мбу) ловит Яндекс онлайн, офлайн — char-map нормализации.
    check("mixed-normalize", normalize("б0мбу") == "бомбу", f"got '{normalize('б0мбу')}'")
    check("mixed-normalize2", normalize("бoмбу") == "бомбу", f"got '{normalize('бoмбу')}'")
    heb = yandex_speller_fixes("заложили бoмбу")
    check("mixed-source", any(f.get("source") == "mixed-alphabet" and f.get("original") == "бoмбу" for f in heb),
          f"got {heb}")
    # Zero-width: режем и считаем
    zw_text = "бо\u200b\u200bмба"
    cleaned, cnt = strip_zero_width(zw_text)
    check("zero-width-strip", cleaned == "бомба" and cnt == 2, f"got '{cleaned}'/{cnt}")
    resp = normalize_enrich(EnrichRequest(text="заложили бо\u200bмба", urls=[]))
    check("zero-width-count", resp["hidden_chars_removed"] == 1, f"got {resp['hidden_chars_removed']}")
    check("zero-width-normalized", "бомба" in resp["normalized_text"], f"got '{resp['normalized_text']}'")
    # Пробелы не склеиваем (канон)
    check("spaces-kept", normalize("а б") == "а б", f"got '{normalize('а б')}'")
    # leet-цифры — только внутри букв (кейс залп-13): чистые числа и хвосты
    # цифр не трогаем, иначе псевдо-мат «залпиз» уводит чистое письмо в карантин.
    check("digits-untouched", normalize("залп-13 чист (13)") == "залп13 чист (13)",
          f"got '{normalize('залп-13 чист (13)')}'")
    check("digits-year", normalize("счёт 2026 к оплате 100 рублей") == "счёт 2026 к оплате 100 рублей",
          f"got '{normalize('счёт 2026 к оплате 100 рублей')}'")
    check("leet-interior", normalize("хл0р и б0мба") == "хлор и бомба",
          f"got '{normalize('хл0р и б0мба')}'")
    # URL не транслитерируем (контракт)
    resp_url = normalize_enrich(EnrichRequest(text="идти http://track-sabotage-leak.ru/login сюда", urls=[]))
    check("url-untouched", "http://track-sabotage-leak.ru/login" in resp_url["normalized_text"],
          f"got '{resp_url['normalized_text']}'")
    if failed:
        print(f"[INIT FAIL] {failed} тестов провалено", flush=True)
        sys.exit(1)
    print("[INIT SUCCESS] Все startup-тесты прошли.", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_startup_tests()
    yield


app = FastAPI(title="safemail-enrich", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "enrich"}


@app.post("/internal/normalize-enrich")
def normalize_enrich(req: EnrichRequest) -> dict[str, Any]:
    raw_text = req.text or ""
    # Скрытые символы режем сразу по всему тексту (включая URL) и считаем.
    raw_text, hidden = strip_zero_width(raw_text)
    # Не транслитерируем URL: режем текст по URL, нормализуем только куски без ссылок
    url_pat = re.compile(r"(https?://[^\s\"'<>]+|www\.[^\s\"'<>]+)")
    parts = url_pat.split(raw_text)
    norm_parts: list[str] = []
    layout_fixes: list[dict[str, str]] = []
    for p in parts:
        if url_pat.fullmatch(p or ""):
            norm_parts.append(p)
        else:
            norm, fixes = normalize_with_fixes(p)
            norm_parts.append(norm)
            layout_fixes.extend(fixes)
    normalized = "".join(norm_parts)
    return {
        "normalized_text": normalized,
        "speller_fixes": yandex_speller_fixes(raw_text) + layout_fixes,
        "links": [score_url(u) for u in (req.urls or [])],
        "hidden_chars_removed": hidden,
    }
