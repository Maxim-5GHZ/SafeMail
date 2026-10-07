"""svc-parser: MIME-разбор EML, извлечение текста, вложений и URL.

Вложения: текст извлекается (PDF через pypdf, office/zip через stdlib, plain/html —
декодированием) и идёт в `extracted_attachments_text` — дальше он входит в
enrich/classify-вход, т.е. угроза внутри PDF/DOC тоже ловится.
Каждое вложение сканируется на опасные признаки (исполняемые расширения, двойные
расширения, макросы VBA, JS/Launch в PDF, скрипты в HTML, exe внутри zip):
флаги едут в `risk_reasons`, gateway блокирует опасное как OTHER_THREAT.
"""
import base64
import io
import re
import sys
import zipfile
from contextlib import asynccontextmanager
from email import policy
from email.parser import BytesParser
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

URL_RE = re.compile(r"https?://[^\s\"'<>]+|www\.[^\s\"'<>]+", re.IGNORECASE)
MAX_ATTACH_B64 = 15_000_000  # ~11 МБ сырого файла, чтобы не раздувать BYTEA
MAX_FILE_TEXT = 20_000  # обрезка извлечённого текста одного вложения
MAX_TOTAL_ATTACH_TEXT = 100_000  # обрезка суммарного текста вложений

# Исполняемые/скриптовые расширения — такое вложение блокируется (is_dangerous).
DANGEROUS_EXTS = frozenset({
    "exe", "dll", "scr", "cpl", "msi", "com", "bat", "cmd", "ps1",
    "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "jar",
    "reg", "inf", "lnk", "gadget", "msc", "pif",
})
# Офисные форматы с макросами.
MACRO_EXTS = frozenset({"docm", "xlsm", "pptm", "dotm", "xltm", "potm"})
OFFICE_ZIP_EXTS = frozenset({
    "docx", "xlsx", "pptx", "dotx", "xltx", "potx",
    "docm", "xlsm", "pptm", "dotm", "xltm", "potm", "odt", "ods", "odp",
})
# Байтовые маркеры активного контента в PDF (регистр разный — ищем lower).
# /OpenAction и /AA сами по себе безобидны (навигация «открыть на странице» —
# так пишет fpdf2/Word), опасны только в связке с JS/Launch.
PDF_JS_MARKERS = (b"/javascript", b"/js ")
PDF_LAUNCH_MARKERS = (b"/launch", b"/embeddedfiles", b"/xfa")
PDF_ACTION_MARKERS = (b"/openaction", b"/aa ")


class ParseRequest(BaseModel):
    raw_base64: str


def run_startup_tests() -> None:
    """Самопроверка скана вложений (§4 AGENTS.md): сначала тест-кейс, потом код."""
    print("[INIT] Self-check скана вложений...", flush=True)
    failed = 0

    def check(name: str, cond: bool) -> None:
        nonlocal failed
        if not cond:
            print(f"[TEST FAIL] {name}", flush=True)
            failed += 1

    # Прямые кейсы
    r = scan_attachment("payload.exe", "application/octet-stream", b"MZ\x90\x00evil")
    check("exe dangerous", r["is_dangerous"] and "executable-ext:exe" in r["risk_reasons"])
    r = scan_attachment("invoice.pdf.exe", "application/octet-stream", b"MZ")
    check("double-extension dangerous",
          r["is_dangerous"] and any(x.startswith("double-extension") for x in r["risk_reasons"]))
    r = scan_attachment("doc.pdf", "application/pdf",
                        b"%PDF-1.4 1 0 obj <</Type/Catalog /OpenAction << /S /JavaScript /JS (evil) >> >>")
    check("pdf-javascript dangerous",
          r["is_dangerous"] and "pdf-javascript" in r["risk_reasons"])
    r = scan_attachment("form.html", "text/html",
                        "<html><body><script>steal(document.cookie)</script>hi</body></html>".encode())
    check("html-script dangerous",
          r["is_dangerous"] and "html-script" in r["risk_reasons"]
          and "steal" not in r["extracted_text"])
    # Транслит имени не прячет расширение: отчёт.pdf.js
    r = scan_attachment("отчёт.pdf.js", "application/javascript", b"evil();")
    check("translit double dangerous", r["is_dangerous"])
    # Обфускация: макрос внутри zip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/vbaProject.bin", b"macro")
        z.writestr("doc.txt", b"hi")
    r = scan_attachment("report.docm", "application/vnd.ms-word", buf.getvalue())
    check("macro-vba dangerous",
          r["is_dangerous"] and "macro-vba" in r["risk_reasons"])
    buf2 = io.BytesIO()
    with zipfile.ZipFile(buf2, "w") as z:
        z.writestr("run.exe", b"MZ")
    r = scan_attachment("files.zip", "application/zip", buf2.getvalue())
    check("zip-exe dangerous",
          r["is_dangerous"] and "archive-contains-executable" in r["risk_reasons"])
    # False-positive: чистые PDF/TXT/JPG не блокируем
    r = scan_attachment("report.pdf", "application/pdf",
                        b"%PDF-1.4 1 0 obj <</Type/Catalog >> hello world")
    check("clean pdf safe", not r["is_dangerous"])
    # Безобидный OpenAction навигации («открыть на странице», так пишет fpdf2) — не угроза.
    r = scan_attachment("report.pdf", "application/pdf",
                        b"%PDF-1.4 1 0 obj <</Type/Catalog /OpenAction [3 0 R /FitH null] /Pages 2 0 R>>")
    check("benign openaction safe", not r["is_dangerous"])
    r = scan_attachment("notes.txt", "text/plain", "Добрый день, высылаю отчёт".encode("utf-8"))
    check("txt extracted+safe",
          not r["is_dangerous"] and "Добрый день" in r["extracted_text"])
    r = scan_attachment("photo.jpg", "image/jpeg", b"\xff\xd8\xff binary-data")
    check("jpg safe", not r["is_dangerous"] and r["extracted_text"] == "")

    if failed:
        print(f"[INIT FAIL] {failed} тестов провалено", flush=True)
        sys.exit(1)
    print("[INIT SUCCESS] Все startup-тесты прошли.", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_startup_tests()
    yield


app = FastAPI(title="safemail-parser", lifespan=lifespan)


def _strip_html(html: str) -> str:
    html = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<style.*?</style>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def _ext_of(filename: str) -> str:
    name = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _extract_pdf_text(payload: bytes) -> str:
    """Текст PDF постранично (pypdf, без внешних бинарей). Ошибка — пусто."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(payload))
        parts = []
        for page in reader.pages[:50]:  # первые 50 страниц достаточно для анализа
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                pass
            if sum(map(len, parts)) >= MAX_FILE_TEXT:
                break
        return re.sub(r"\s+", " ", " ".join(parts)).strip()[:MAX_FILE_TEXT]
    except Exception:
        return ""


def _extract_office_zip_text(payload: bytes) -> str:
    """Текст из OOXML/ODF через stdlib-zip: document.xml/content.xml + sharedStrings."""
    try:
        texts: list[str] = []
        with zipfile.ZipFile(io.BytesIO(payload)) as z:
            for name in z.namelist():
                low = name.lower()
                if not (low.endswith(".xml") and (
                        "document" in low or "sharedstrings" in low or "content" in low
                        or "slides/slide" in low or "worksheets/sheet" in low)):
                    continue
                try:
                    raw = z.read(name).decode("utf-8", errors="ignore")
                except Exception:
                    continue
                raw = re.sub(r"<w:tab[^/]*/?>", " ", raw)
                texts.append(_strip_html(raw))
                if sum(map(len, texts)) >= MAX_FILE_TEXT:
                    break
        return re.sub(r"\s+", " ", " ".join(texts)).strip()[:MAX_FILE_TEXT]
    except Exception:
        return ""


def scan_attachment(filename: str, content_type: str, payload: bytes) -> dict[str, Any]:
    """Проверка вложения на скрипты/активный контент/исполняемость.

    Возвращает {extracted_text, is_dangerous, risk_score, risk_reasons}.
    risk_reasons — стабильные snake-id (gateway маппит во флаги `attachment:<id>`).
    Новое правило (§4 AGENTS.md): сначала тест-кейс, потом код.
    """
    reasons: list[str] = []
    score = 0
    ext = _ext_of(filename)
    ctype = (content_type or "").lower()

    # 1. Исполняемое расширение — сразу опасно.
    if ext in DANGEROUS_EXTS:
        reasons.append(f"executable-ext:{ext}")
        score = max(score, 100)
    # 2. Двойное расширение-маскировка: invoice.pdf.exe, doc.scr и т.п.
    base = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    parts = base.lower().split(".")
    if len(parts) >= 3 and parts[-1] in DANGEROUS_EXTS:
        reasons.append(f"double-extension:{parts[-2]}.{parts[-1]}")
        score = max(score, 100)
    elif len(parts) >= 3 and parts[-1] in {"zip", "rar", "7z"} and parts[-2] in DANGEROUS_EXTS:
        reasons.append(f"double-extension:{parts[-2]}.{parts[-1]}")
        score = max(score, 90)

    extracted = ""
    low_name = base.lower()

    # 3. PDF: текст + маркеры JS/Launch/Embedded.
    if ext == "pdf" or payload[:5] == b"%PDF-":
        extracted = _extract_pdf_text(payload)
        low = payload.lower()
        has_js = any(m in low for m in PDF_JS_MARKERS)
        has_launch = any(m in low for m in PDF_LAUNCH_MARKERS)
        has_action = any(m in low for m in PDF_ACTION_MARKERS)
        if has_js:
            reasons.append("pdf-javascript")
            score = max(score, 90)
        if has_launch:
            reasons.append("pdf-launch-or-embedded")
            score = max(score, 90)
        # OpenAction/Additional-Actions без кода (просто «открыть на странице») —
        # не угроза, так пишут обычные генераторы (fpdf2, Word).
        if has_action and not (has_js or has_launch):
            pass
    # 4. Office zip-форматы: текст + поиск vbaProject.bin (макрос).
    elif ext in OFFICE_ZIP_EXTS or (payload[:2] == b"PK" and ext in MACRO_EXTS):
        extracted = _extract_office_zip_text(payload)
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as z:
                names = [n.lower() for n in z.namelist()]
            if any("vbaproject.bin" in n for n in names):
                reasons.append("macro-vba")
                score = max(score, 95)
        except Exception:
            pass
        if ext in MACRO_EXTS and "macro-vba" not in reasons:
            reasons.append("macro-extension")
            score = max(score, 70)
    # 5. HTML/SVG: текст + скрипты/обработчики событий.
    elif ext in {"html", "htm", "svg", "xhtml"} or ctype.startswith("text/html"):
        try:
            html = payload.decode("utf-8", errors="ignore")
        except Exception:
            html = ""
        extracted = _strip_html(html)[:MAX_FILE_TEXT]
        low_html = html.lower()
        if "<script" in low_html or "javascript:" in low_html or re.search(r"\son\w+\s*=", low_html):
            reasons.append("html-script")
            score = max(score, 85)
    # 6. ZIP: что внутри (exe/js/vba/скрипты), шифрование.
    elif ext == "zip" or payload[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as z:
                infos = z.infolist()
                names = [i.filename.lower() for i in infos]
                inner_exts = {_ext_of(n) for n in names}
                if inner_exts & DANGEROUS_EXTS:
                    reasons.append("archive-contains-executable")
                    score = max(score, 90)
                if any("vbaproject.bin" in n for n in names):
                    reasons.append("macro-vba")
                    score = max(score, 95)
                if any(i.flag_bits & 0x1 for i in infos):
                    reasons.append("encrypted-archive")
                    score = max(score, 50)
        except Exception:
            pass
    # 7. Текстовые форматы: декодируем как есть (идут в анализ).
    elif ctype.startswith("text/") or ext in {
            "txt", "csv", "log", "json", "xml", "md", "eml"}:
        try:
            extracted = payload.decode("utf-8", errors="ignore")
            extracted = re.sub(r"\s+", " ", extracted).strip()[:MAX_FILE_TEXT]
        except Exception:
            extracted = ""
    # 8. MIME-mismatch: расширение говорит одно, Content-Type — другое.
    if ext == "pdf" and ctype and "pdf" not in ctype and not ctype.startswith("application/octet"):
        reasons.append("mime-mismatch")
        score = max(score, 40)
    if ext in DANGEROUS_EXTS and ctype in {"application/pdf", "image/jpeg", "image/png"}:
        reasons.append("mime-mismatch")
        score = max(score, 60)

    # Опасный скрипт прямо в имени (invoice.js, payload.vbs без точки не ловим — ext уже сработал).
    if low_name.endswith((".js", ".vbs", ".ps1", ".hta")) and not reasons:
        reasons.append("script-file")
        score = max(score, 85)

    return {
        "extracted_text": extracted,
        "is_dangerous": score >= 70,
        "risk_score": min(score, 100),
        "risk_reasons": reasons,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "parser"}


@app.post("/internal/parse-extract")
def parse_extract(req: ParseRequest) -> dict[str, Any]:
    raw = base64.b64decode(req.raw_base64)
    msg = BytesParser(policy=policy.default).parsebytes(raw)

    subject = str(msg["Subject"] or "")
    smtp_id = str(msg["Message-ID"] or "")
    texts: list[str] = []
    attachments: list[dict[str, Any]] = []

    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = part.get_content_disposition()
            if disp == "attachment" or (part.get_filename() and disp != "inline"):
                filename = part.get_filename() or "unnamed"
                payload = part.get_payload(decode=True) or b""
                b64 = base64.b64encode(payload).decode() if len(payload) < MAX_ATTACH_B64 else ""
                scan = scan_attachment(filename, ctype, payload)
                attachments.append({
                    "filename": filename,
                    "content_type": ctype,
                    "size": len(payload),
                    "content_base64": b64,
                    "extracted_text": scan["extracted_text"],
                    "is_dangerous": scan["is_dangerous"],
                    "risk_score": scan["risk_score"],
                    "risk_reasons": scan["risk_reasons"],
                })
            elif ctype == "text/plain":
                try:
                    texts.append(str(part.get_content()))
                except Exception:
                    pass
            elif ctype == "text/html":
                try:
                    texts.append(_strip_html(str(part.get_content())))
                except Exception:
                    pass
    else:
        try:
            c = msg.get_content()
            texts.append(_strip_html(c) if msg.get_content_type() == "text/html" else str(c))
        except Exception:
            texts.append(raw.decode("utf-8", errors="ignore")[:20000])

    clean_text = re.sub(r"\s+", " ", " ".join(texts)).strip()[:100000]
    urls = sorted(set(URL_RE.findall(clean_text)))
    # Текст вложений — в общий анализ (угроза внутри PDF/DOC тоже ловится).
    attach_texts = [a.get("extracted_text", "") for a in attachments]
    extracted_attachments_text = re.sub(
        r"\s+", " ", " ".join(t for t in attach_texts if t)).strip()[:MAX_TOTAL_ATTACH_TEXT]

    return {
        "subject": subject,
        "smtp_message_id": smtp_id,
        "clean_text": clean_text,
        "extracted_attachments_text": extracted_attachments_text,
        "has_attachments": bool(attachments),
        "attachments_count": len(attachments),
        "attachments": attachments,
        "links": [{"url": u} for u in urls],
    }
