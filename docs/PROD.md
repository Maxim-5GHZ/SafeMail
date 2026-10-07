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

## 3. Окружение

```env
MAIL_DOMAIN=mysec.ru
MAIL_RELAY_HOST=smtp.your-provider.ru   # реальный relay для чистой почты
MAIL_RELAY_PORT=587
JWT_SECRET=<openssl rand -base64 48>    # обязательно сменить
APP_ADMIN_PASSWORD=<стойкий пароль>     # обязательно сменить
POSTGRES_PASSWORD=<стойкий пароль>      # обязательно сменить
```

Серты nginx: самоподпись из `nginx/gen-certs.sh` — только для демо;
в проде положите в `nginx/certs/` настоящий сертификат (или certbot).

## 4. Подъём и тест

```bash
cp .env.example .env   # + заполнить прод-значения
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

1. С обычного Gmail отправьте письмо на `denden@mysec.ru` (пользователь из системы).
2. Цепочка: Google → `MX mysec.ru` → ваш IP `:25` → SubEthaSMTP →
   `InboundPipelineService` (сырой EML в Postgres) → поллер → парсер/спеллер/SLM →
   письмо во входящих фронта или карантин в `/admin`.
3. Если до защиты мало времени или хостер не открыл 25-й порт — не рискуйте,
   демьте на локальном стенде с MailHog (`docker compose up -d`, relay `mailhog:1025`).
