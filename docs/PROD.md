# SafeMail в проде: приём почты из интернета (Gmail → шлюз)

Принять входящее из реального Gmail **проще**, чем слать наружу: DKIM/PTR/прогретый IP
не нужны — это Gmail шлёт вам, а не вы ему. SubEthaSMTP уже слушает и запускает
AI-пайплайн (`GatewayConfig`: 2 инстанса — MX-порт и submission).

## 1. Порт 25 на VPS (главная засада)

Интернет-MTA (включая Google) шлют почту **только на 25-й порт**.
`docker-compose.prod.yml` уже маппит `25:2525` и `587:2587`.

Почти все хостеры (Timeweb, Selectel, Hetzner, DO, AWS) **блокируют 25-й порт
по умолчанию**. Напишите в техподдержку заранее:
«Откройте, пожалуйста, 25-й порт для входящей почты».
Проверка с VPS: `telnet localhost 25` → должен ответить SubEthaSMTP-баннер.

## 2. DNS у домена (пример: домен `mysec.ru`, IP сервера `1.2.3.4`)

| Тип | Имя | Значение |
|-----|-----|----------|
| A | `mail.mysec.ru` | `1.2.3.4` |
| MX | `@` (приоритет 10) | `mail.mysec.ru.` |

Проверка распространения: `dig MX mysec.ru +short` → `10 mail.mysec.ru.`
Распространение занимает от 15 минут до 2 часов — закладывайте время до демо.

## 3. Окружение (`.env` на VPS — единственный файл, который читает compose)

```env
# Домен ящиков: регистрация username -> username@mysec.ru, админ — admin@mysec.ru
MAIL_DOMAIN=mysec.ru   # только сид при ПЕРВОМ старте; дальше домен меняется в /admin → Настройки

POSTGRES_DB=safemail
POSTGRES_USER=safemail
POSTGRES_PASSWORD=<стойкий пароль>      # обязательно сменить
DATABASE_URL=jdbc:postgresql://postgres:5432/safemail
POSTGRES_HOST_PORT=5432
GATEWAY_HOST_PORT=8080

SMTP_PORT=2525
SMTP_HOST=0.0.0.0
MAIL_RELAY_HOST=mailhog   # демо только на приём; relay чистой почты через него (--profile debug)
MAIL_RELAY_PORT=1025

PARSER_URL=http://ml-parser:8001
ENRICH_URL=http://ml-enrich:8002
CLASSIFY_URL=http://ml-classify:8003

ROUTE_TERRORISM=infosec@mysec.ru   # куда уходят угрозы (перекрывается таблицей threat_routing_rules)
ROUTE_MAN_MADE=infosec@mysec.ru
ROUTE_ILLEGAL=infosec@mysec.ru
ROUTE_OTHER=infosec@mysec.ru

JWT_SECRET=<openssl rand -base64 48>       # обязательно сменить
APP_ADMIN_PASSWORD=<стойкий пароль>        # обязательно сменить
GIGACHAT_API_KEY=<ключ>                    # семантика classify; без него — rule-based fallback

BACKEND_URL=http://gateway:8080
NEXT_PUBLIC_MAIL_DOMAIN=mysec.ru   # = MAIL_DOMAIN (compose подставит сам, но пусть не врёт)

NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
```

Входящая почта из интернета релея НЕ требует: при выключенном реле (дефолт)
чистые письма сразу падают во «Входящие» фронта (`STORED_LOCALLY`),
угрозы — в карантин `/admin` (тоже локально, без SMTP-копий).

Серты nginx: самоподпись из `nginx/gen-certs.sh` — только для демо;
в проде положите в `nginx/certs/` настоящий сертификат (или certbot).

## 4. Подъём и тест

```bash
cp .env.example .env   # + заполнить прод-значения из §3 выше
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile debug up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```
(`--profile debug` нужен: mailhog в проде по умолчанию не стартует,
а relay чистой почты идёт через него, иначе статусы упадут в FAILED.)

1. С обычного Gmail отправьте письмо на `denden@mysec.ru` (пользователь из системы).
2. Цепочка: Google → `MX mysec.ru` → ваш IP `:25` → SubEthaSMTP →
   `InboundPipelineService` (сырой EML в Postgres) → поллер → парсер/спеллер/SLM →
   письмо во входящих фронта или карантин в `/admin`.
3. Домены и алиасы (`mysec.ru` + `mail.mysec.ru`) правятся вживую:
   `/admin` → Настройки → «Почтовый домен и приём писем» (без пересборки).
   Релей для входящей не нужен — держите его выключенным.
4. Если до защиты мало времени или хостер не открыл 25-й порт — не рискуйте,
   демьте на локальном стенде (`docker compose up -d`, Gmail не нужен).
