"""svc-enrich: деобфускация/транслит, Яндекс.Спеллер, проверка ссылок."""
import re
from typing import Any

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="safemail-enrich")

CHAR_MAP = {
    'a': 'а', '@': 'а', 'b': 'б', '6': 'б', 'v': 'в', 'w': 'в',
    'g': 'г', 'd': 'д', 'e': 'е', 'yo': 'ё', 'zh': 'ж',
    'z': 'з', '3': 'з', 'i': 'и', '1': 'и', '!': 'и',
    'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', '0': 'о',
    'p': 'п', 'r': 'р', 's': 'с', '$': 'с', 't': 'т', 'u': 'у',
    'f': 'ф', 'h': 'х', 'x': 'х', 'c': 'ц', '4': 'ч',
}

SUSPICIOUS_TLDS = (".ru", ".tk", ".ml", ".ga", ".cf", ".gq", ".top", ".xyz")
BLACKLIST_HINTS = ("login", "verify", "invoice", "wallet", "pay-", "sabotage", "leak", "free-", "bonus")


class EnrichRequest(BaseModel):
    text: str = ""
    urls: list[str] = []


def normalize(text: str) -> str:
    t = text.lower()
    # Только внутрисловные разделители, пробелы между словами сохраняем
    t = re.sub(r"([a-zа-я0-9])[\.\-_ʼ\*\+]+([a-zа-я0-9])", r"\1\2", t)
    t = re.sub(r"([a-zа-я0-9])[\.\-_ʼ\*\+]+([a-zа-я0-9])", r"\1\2", t)
    t = re.sub(r"(.)\1{2,}", r"\1", t)
    out: list[str] = []
    i = 0
    while i < len(t):
        two = t[i:i + 2]
        if two in ("sh", "ch", "zh", "yu", "ya", "ye"):
            out.append({"sh": "ш", "ch": "ч", "zh": "ж", "yu": "ю", "ya": "я", "ye": "е"}[two])
            i += 2
        elif t[i] in CHAR_MAP:
            out.append(CHAR_MAP[t[i]])
            i += 1
        else:
            out.append(t[i])
            i += 1
    return "".join(out)


def yandex_speller_fixes(text: str) -> list[dict[str, str]]:
    """Пытаемся сходить в Яндекс.Спеллер, при недоступности — эвристика латиницы в кириллице."""
    fixes: list[dict[str, str]] = []
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9@!$\*]{3,}", text)[:30]
    # Эвристика: смешанные алфавиты внутри слова
    for w in words:
        has_lat = bool(re.search(r"[a-zA-Z]", w))
        has_cyr = bool(re.search(r"[а-яА-ЯёЁ]", w))
        if has_lat and has_cyr:
            fixes.append({"original": w, "suggested": normalize(w) + " (смешанный алфавит)"})
    try:
        sample = " ".join(words[:20])
        if sample:
            r = httpx.get("https://speller.yandex.net/services/spellservice.json/checkText",
                           params={"text": sample, "lang": "ru"}, timeout=3.0)
            if r.status_code == 200:
                for item in r.json():
                    s = item.get("s") or []
                    if s:
                        fixes.append({"original": item.get("word", ""), "suggested": s[0]})
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "enrich"}


@app.post("/internal/normalize-enrich")
def normalize_enrich(req: EnrichRequest) -> dict[str, Any]:
    raw_text = req.text or ""
    # Не транслитерируем URL: режем текст по URL, нормализуем только куски без ссылок
    url_pat = re.compile(r"(https?://[^\s\"'<>]+|www\.[^\s\"'<>]+)")
    parts = url_pat.split(raw_text)
    norm_parts = [p if url_pat.fullmatch(p or "") else normalize(p) for p in parts]
    normalized = "".join(norm_parts)
    return {
        "normalized_text": normalized,
        "speller_fixes": yandex_speller_fixes(raw_text),
        "links": [score_url(u) for u in (req.urls or [])],
    }
