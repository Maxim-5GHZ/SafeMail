"""svc-parser: MIME-разбор EML, извлечение текста, вложений и URL."""
import base64
import re
from email import policy
from email.parser import BytesParser
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="safemail-parser")

URL_RE = re.compile(r"https?://[^\s\"'<>]+|www\.[^\s\"'<>]+", re.IGNORECASE)
MAX_ATTACH_B64 = 15_000_000  # ~11 МБ сырого файла, чтобы не раздувать BYTEA


class ParseRequest(BaseModel):
    raw_base64: str


def _strip_html(html: str) -> str:
    html = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<style.*?</style>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


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
                attachments.append({
                    "filename": filename,
                    "content_type": ctype,
                    "size": len(payload),
                    "content_base64": b64,
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

    return {
        "subject": subject,
        "smtp_message_id": smtp_id,
        "clean_text": clean_text,
        "extracted_attachments_text": "",
        "has_attachments": bool(attachments),
        "attachments_count": len(attachments),
        "attachments": attachments,
        "links": [{"url": u} for u in urls],
    }
