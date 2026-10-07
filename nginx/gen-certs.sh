#!/usr/bin/env bash
# Генерация самоподписанного серта для локального стенда (MVP).
# Приватный ключ остаётся только на хосте: nginx/certs/ в .gitignore, в репо не коммитить.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout certs/safemail.key \
  -out certs/safemail.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.corp-sec.ru,IP:127.0.0.1"
chmod 600 certs/safemail.key
echo "OK: certs/safemail.crt + certs/safemail.key (825 дней, CN=localhost)"
