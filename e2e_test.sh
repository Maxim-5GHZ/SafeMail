#!/usr/bin/env bash
# SafeMail end-to-end: сценарии А (легитимный) + Б (угроза) без фронта.
# Требует запущенный стенд: postgres + ml-parser/enrich/classify + gateway
#   docker compose up --build -d
# Прогон:
#   ./e2e_test.sh
# Переменные: BASE_URL (default http://localhost:8080),
#   SMTP_HOST/SMTP_PORT (default localhost:2525), MAIL_DOMAIN (default corp-sec.ru),
#   APP_ADMIN_PASSWORD (пароль admin@MAIL_DOMAIN, default admin).
set -u

BASE_URL="${BASE_URL:-http://localhost:8080}"
SMTP_HOST="${SMTP_HOST:-localhost}"
SMTP_PORT="${SMTP_PORT:-2525}"
MAIL_DOMAIN="${MAIL_DOMAIN:-corp-sec.ru}"
ADMIN_PASSWORD="${APP_ADMIN_PASSWORD:-admin}"
TS="$(date +%s)"
ALICE="alice_e2e_${TS}"
BOB="bob_e2e_${TS}"
PASS="Test1234!"
ALICE_EMAIL="${ALICE}@${MAIL_DOMAIN}"
BOB_EMAIL="${BOB}@${MAIL_DOMAIN}"
LEGIT_SUBJ="E2E invoice ${TS}"
THREAT_SUBJ="E2E срочно ${TS}"
PASS_N=0
FAIL_N=0

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
ok() { PASS_N=$((PASS_N+1)); green "  [PASS] $*"; }
fail() { FAIL_N=$((FAIL_N+1)); red "  [FAIL] $*"; }

need() { command -v "$1" >/dev/null 2>&1 || { red "Нужна утилита: $1"; exit 1; }; }
need curl
need python3

jtoken() { python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))'; }

# --- 0. Ждём gateway (без токена /messages должен ответить 401/403 — значит, жив) ---
echo "== 0. Gateway ${BASE_URL} =="
UP=0
for _ in $(seq 1 60); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${BASE_URL}/api/v1/messages?size=1" || true)"
  if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then UP=1; break; fi
  sleep 2
done
[ "$UP" = "1" ] && ok "gateway отвечает" || { fail "gateway не отвечает"; exit 1; }

# --- 1. Регистрация двух пользователей через API ---
echo "== 1. Регистрация =="
ALICE_TOKEN="$(curl -s --max-time 10 -X POST "${BASE_URL}/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ALICE}\",\"password\":\"${PASS}\"}" | jtoken)"
BOB_TOKEN="$(curl -s --max-time 10 -X POST "${BASE_URL}/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${BOB}\",\"password\":\"${PASS}\"}" | jtoken)"
ADMIN_TOKEN="$(curl -s --max-time 10 -X POST "${BASE_URL}/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@${MAIL_DOMAIN}\",\"password\":\"${ADMIN_PASSWORD}\"}" | jtoken)"
[ -n "$ALICE_TOKEN" ] && ok "alice зарегистрирована" || fail "alice не зарегистрирована"
[ -n "$BOB_TOKEN" ] && ok "bob зарегистрирован" || fail "bob не зарегистрирован"
[ -n "$ADMIN_TOKEN" ] && ok "admin login" || fail "admin login"

# --- 2. Легитимное письмо с PDF через API ---
echo "== 2. Легитимное письмо (сценарий А) =="
PDF="/tmp/e2e_legit_${TS}.pdf"
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > "$PDF"
SEND_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "${BASE_URL}/api/v1/messages/send" \
  -H "Authorization: Bearer ${ALICE_TOKEN}" \
  -F "from=${ALICE_EMAIL}" -F "to=${BOB_EMAIL}" \
  -F "subject=${LEGIT_SUBJ}" -F "body=Добрый день! Счёт во вложении, оплата до пятницы." \
  -F "files=@${PDF};type=application/pdf")"
[ "$SEND_CODE" = "202" ] && ok "send вернул 202" || fail "send вернул ${SEND_CODE}"

echo "   ждём DELIVERED..."
LEGIT_JSON=""; LEGIT_ID=""
for _ in $(seq 1 30); do
  LEGIT_JSON="$(curl -s --max-time 10 "${BASE_URL}/api/v1/messages?sender=${ALICE_EMAIL}&size=100" \
    -H "Authorization: Bearer ${BOB_TOKEN}")"
  LEGIT_ID="$(printf '%s' "$LEGIT_JSON" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for m in d.get('content', []):
    if m.get('subject') == '${LEGIT_SUBJ}':
        print(m['id'] + '|' + m.get('status',''))
        break
" 2>/dev/null)"
  case "$LEGIT_ID" in *"|DELIVERED") break;; esac
  sleep 5
done
case "$LEGIT_ID" in
  *"|DELIVERED") ok "легитимное DELIVERED";;
  *) fail "легитимное не DELIVERED: ${LEGIT_ID:-не найдено}";;
esac

LEGIT_ID="${LEGIT_ID%%|*}"
if [ -n "$LEGIT_ID" ]; then
  DETAIL="$(curl -s --max-time 10 "${BASE_URL}/api/v1/messages/${LEGIT_ID}" -H "Authorization: Bearer ${BOB_TOKEN}")"
  printf '%s' "$DETAIL" | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert d.get('verdict') in (None, 'NONE'), d.get('verdict')
assert len(d.get('attachments', [])) == 1, d.get('attachments')
print('detail ok')
" 2>/dev/null && ok "вердикт NONE + вложение в деталке" || fail "деталка легитимного"
  ATT_ID="$(printf '%s' "$DETAIL" | python3 -c 'import json,sys; a=json.load(sys.stdin).get("attachments",[]); print(a[0]["id"] if a else "")' 2>/dev/null)"
  if [ -n "$ATT_ID" ] \
    && curl -s --max-time 10 "${BASE_URL}/api/v1/messages/${LEGIT_ID}/attachments/${ATT_ID}" \
         -H "Authorization: Bearer ${BOB_TOKEN}" -o "/tmp/e2e_dl_${TS}.pdf" \
    && cmp -s "$PDF" "/tmp/e2e_dl_${TS}.pdf"; then
    ok "вложение скачалось байт-в-байт"
  else
    fail "скачивание вложения"
  fi
fi

# --- 3. Угроза с обфускацией через SMTP (сценарий Б) ---
echo "== 3. Угроза через SMTP =="
SMTP_OK="$(MAIL_DOMAIN="$MAIL_DOMAIN" ALICE_EMAIL="$ALICE_EMAIL" THREAT_SUBJ="$THREAT_SUBJ" \
  SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" python3 - <<'EOF'
import os, smtplib
from email.message import EmailMessage
m = EmailMessage()
m["From"] = "attacker@evil.local"
m["To"] = os.environ["ALICE_EMAIL"]
m["Subject"] = os.environ["THREAT_SUBJ"]
m.set_content("На перегоне цистерны с хл0ром. Мы зал0жили б0мбу на в0кзале, "
              "инструкция тут http://track-sabotage-leak.ru/login — никому ни слова.")
try:
    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]), timeout=15) as s:
        s.send_message(m)
    print("SMTP_OK")
except Exception as e:
    print(f"SMTP_FAIL: {e}")
EOF
)"
[ "$SMTP_OK" = "SMTP_OK" ] && ok "угроза принята по SMTP" || fail "SMTP inject: ${SMTP_OK}"

echo "   ждём REROUTED..."
THREAT_DETAIL=""
for _ in $(seq 1 36); do
  LIST="$(curl -s --max-time 10 "${BASE_URL}/api/v1/messages?sender=attacker@evil.local&size=100" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}")"
  TID="$(printf '%s' "$LIST" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for m in d.get('content', []):
    if m.get('subject') == '${THREAT_SUBJ}':
        print(m['id'])
        break
" 2>/dev/null)"
  if [ -n "$TID" ]; then
    THREAT_DETAIL="$(curl -s --max-time 10 "${BASE_URL}/api/v1/messages/${TID}" \
      -H "Authorization: Bearer ${ADMIN_TOKEN}")"
    ST="$(printf '%s' "$THREAT_DETAIL" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)"
    if [ "$ST" = "REROUTED" ] || [ "$ST" = "DELIVERED" ] || [ "$ST" = "FAILED" ]; then break; fi
  fi
  sleep 5
done
ST="$(printf '%s' "$THREAT_DETAIL" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)"
[ "$ST" = "REROUTED" ] && ok "угроза REROUTED (получатель ничего не получил)" \
  || fail "статус угрозы: ${ST:-не найдено}"

if [ -n "$THREAT_DETAIL" ]; then
  printf '%s' "$THREAT_DETAIL" | python3 -c "
import json,sys
d = json.load(sys.stdin)
t = d.get('threat') or {}
assert (t.get('category') or 'NONE') != 'NONE', 'нет вердикта'
assert d.get('normalizedText'), 'нет normalizedText'
assert any((l.get('reputationScore') or 0) > 0 for l in d.get('links', [])), 'нет скоринга ссылок'
assert d.get('deliveries'), 'нет delivery_logs'
print('quarantine detail ok')
" 2>/dev/null && ok "карантин: вердикт + normalized + скоринг + маршрут" \
    || fail "деталка карантина неполная"
  # Ни одного DELIVERED с темой угрозы (ни получателю, ни кому-либо)
  LEAK="$(curl -s --max-time 10 "${BASE_URL}/api/v1/messages?size=100" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" | python3 -c "
import json,sys
d = json.load(sys.stdin)
bad = [m['id'] for m in d.get('content', []) if m.get('subject') == '${THREAT_SUBJ}' and m.get('status') == 'DELIVERED']
print('LEAK' if bad else 'NOLEAK')
" 2>/dev/null)"
  [ "$LEAK" = "NOLEAK" ] && ok "утечки адресату нет" || fail "угроза где-то DELIVERED!"
  # Правило маршрутизации активно
  RULES="$(curl -s --max-time 10 "${BASE_URL}/api/v1/routing-rules" -H "Authorization: Bearer ${ADMIN_TOKEN}")"
  printf '%s' "$RULES" | python3 -c "
import json,sys
d = json.load(sys.stdin)
rules = d if isinstance(d, list) else d.get('content', d)
assert any(r.get('active') and r.get('destinationEmails') for r in (rules if isinstance(rules, list) else [])), 'нет активных правил'
print('rules ok')
" 2>/dev/null && ok "маршрутизация на адреса ИБ активна" || fail "правила маршрутизации"
fi

rm -f "$PDF" "/tmp/e2e_dl_${TS}.pdf"

# --- Итог ---
echo "----------------------------------------"
echo "PASS: ${PASS_N}  FAIL: ${FAIL_N}"
if [ "$FAIL_N" = "0" ]; then
  green "ALL TESTS PASSED. GATEWAY IS SECURE."
  exit 0
else
  red "E2E FAILED"
  exit 1
fi
