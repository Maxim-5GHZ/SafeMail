# SafeMail — AGENTS.md

> SMTP-шлюз с ИИ-фильтром. Читать этот файл перед любыми изменениями.

## 1. Суть проекта (одним абзацем)

Шлюз стоит в цепочке `антиспам → SafeMail → почтовый сервер`.
Всё входящее (плюс внутренняя переписка внутри своего домена через hairpin)
идёт через пайплайн: **парсинг → спеллер/деобфускация + проверка ссылок →
эвристика + SLM**. Чистое письмо доставляется адресату **байт-в-байт без
изменений**. Угроза одной из 4 категорий — **не доставляется**, а уходит по
заранее заданным адресам ИБ и ложится в карантин с разбором
(подсветка фраз, спеллер, фишинг). Исходящее наружу не проверяется.

Категории угроз (`threat_category`): `NONE`, `TERRORISM`, `MAN_MADE`,
`ILLEGAL_ACTIONS`, `OTHER_THREAT`.

## 2. Архитектура и порты

```
                    ┌─────────────┐
                    │  Антиспам   │──┐
                    └─────────────┘  │ :2525 (в проде :25)
                                     ▼
┌──────┐  :2587(subm)  ┌──────────────────────┐   HTTP    ┌────────────┐
│ Юзер │──────────────▶│  gateway-java (8080) │──────────▶│ ml-parser  │ :8001
└──────┘               │  SubEthaSMTP + REST  │──        ▶│ ml-enrich  │ :8002
                       │  PostgreSQL-очередь  │─        ─▶│ ml-classify│ :8003
                       └──────────┬───────────┘           └────────────┘
                                  │ relay (1025/mailhog в dev)
                                  ▼
                          получатель / ИБ-адреса
```

- Вариант хранения **А**: сырой EML и вложения — `BYTEA` в Postgres
  (лимит одного вложения ~20 МБ, режется в коде). S3/MinIO — только следующим
  этапом, интерфейсы под него не ломать.
- Очередь без Kafka: `status='PENDING'` + `FOR UPDATE SKIP LOCKED` +
  атомарный claim `claimAsInProgress → IN_PROGRESS` (по одному письму в своей
  транзакции через `processClaimed`), зависшие `IN_PROGRESS` старше 30 мин
  возвращаются в `PENDING` (`resetStale`). Поллинг каждые 5 с.
  Один `RCPT TO` = одна строка `messages` (мультиполучатели размножаются
  в `InboundMessageHandlerFactory`).
- Hairpin (`MailRoutingService`): получатель на `MAIL_DOMAIN` → внутрь
  пайплайна; чужой домен → сразу в relay без ИИ.
- SLM-лимит: **4 ГБ RAM**. Сейчас rule-based fallback; hook под GGUF
  (`MODEL_PATH`, `Qwen2.5-1.5B-Q4`) уже заложен в `ml-classify`.

## 3. Бэкенд Java (`gateway-java/`)

Spring Boot 3.2, Java 21, Flyway, JPA, SubEthaSMTP 3.1.7, JJWT.

```
src/main/java/ru/security/gateway/
  GatewayApplication.java
  config/GatewayConfig.java      # 2 инстанса SMTPServer (2525+2587), JavaMailSender, RestTemplate
  smtp/InboundMessageHandlerFactory.java  # from/recipient/data → receiveRaw()
  domain/                        # Message, MessageParsedData, MessageAttachment,
                                 # MessageLink, MessageThreatAnalysis, ThreatRoutingRule, DeliveryLog, User
  repository/                    # + MessageRepository.pickForProcessing (SKIP LOCKED)
  service/
    InboundPipelineService.java  # receiveRaw + pollAndProcess + processOne + router
    MailRoutingService.java      # sendEmail с hairpin
    MessageService.java          # фильтры/пагинация/деталка/reprocess/правила
    AuthService.java             # register username→email@MAIL_DOMAIN, BCrypt+JWT
  controller/                    # Auth, MessageGateway, RoutingRule, GlobalExceptionHandler
  security/                      # JwtService, JwtAuthFilter, SecurityConfig
```

Стиль и правила:

- Lombok `@Getter/@Setter/@Builder`, `OffsetDateTime`, `UUID` для PK.
- PG-enum: `@Enumerated(STRING) + @JdbcTypeCode(NAMED_ENUM)`.
  `text[]`: `@JdbcTypeCode(ARRAY)`. `jsonb`: `@JdbcTypeCode(JSON)` поверх `String`.
  Ловушка Hibernate 6: HQL bulk-`UPDATE` с enum-литералом рендерит каст
  `::MessageStatus` (имя Java-класса), а тип в PG — `message_status`.
  Поэтому claim/reset очереди — только native `CAST('X' AS message_status)`.
- Миграции **только** `src/main/resources/db/migration/V*__*.sql`, руками
  таблицы не править. `ddl-auto: validate`.
- Новые ручки: `@Validated` + `@Email/@Min/@Max`, пагинация
  `page,size(≤100),sortBy,direction`. `sortBy` — только из белого списка
  (`resolveSortBy`, иначе откат на `createdAt`). Ошибки — через
  `GlobalExceptionHandler` (включая общий 500 → JSON).
- Роли: `users.role` (`USER`/`ADMIN`), JWT несёт `role`, фильтр ставит
  `ROLE_*`. `/routing-rules/**` — только `ADMIN`. MVP-админ `admin/admin`
  создаётся `AdminBootstrap` (пароль — `APP_ADMIN_PASSWORD`).
- `RestTemplate` — с таймаутами (connect 3 с / read 15 с), иначе зависший ML
  вешает поллер.
- `processOne` делает fallback при недоступности ML (пустой `Map.of()`),
  не ронять SMTP-сессию: приём всегда быстрый, тяжёлое — в поллере.
  Тема письма обязательно входит в enrich/classify-вход
  (`subject + cleanText + attachments`), иначе угроза только в теме не ловится.
- Чистая доставка — оригинальными байтами (`new MimeMessage(session, stream)`),
  карантинная — новое письмо с `[QUARANTINE <CAT>]` + `delivery_logs`.

## 4. Python ML (`ml-parser/`, `ml-enrich/`, `ml-classify/`)

FastAPI, контракты — `POST /internal/*`, `GET /health`. Стиль: маленькие
модули, `pydantic`-модели запросов, без тяжёлых зависимостей
(`requirements.txt`: `fastapi, uvicorn(без [standard]), httpx|multipart`).

- **parser** `POST /internal/parse-extract {raw_base64}` →
  `{clean_text, attachments[{filename,content_type,content_base64}], links[{url}]}`.
- **enrich** `POST /internal/normalize-enrich {text, urls}` →
  `{normalized_text, speller_fixes[{original,suggested}], links[{url,is_phishing,risk_score}]}`.
  URL транслитерировать **запрещено** (резать текст по URL, нормализовать
  только куски). Скоринг: IP +50, хит чёрного списка +30/+15, без TLS +10.
- **classify** `POST /internal/classify-threat {text}` →
  `{category, confidence, explanation, heuristic_score, heuristic_flags}`.
  Внутри `ToxicityAndProfanityFilter.normalize/analyze`:
  склейка только `.-_*+` внутри слов (пробелы хранить!), `y→й`,
  safe-подстроки (`колебан, рубл, скипидар…`) не считать матом.
  Направленный мат/оскорбления без других маркеров — `OTHER_THREAT 0.75`
  (иначе «мат в теме при пустом теле» уходил `DELIVERED`).
- Startup-тесты (`run_startup_tests`, `lifespan`) обязаны проходить,
  иначе процесс падает с `exit 1`. Новое правило — сначала тест-кейс
  (прямой/транслит/обфускация/false-positive), потом код.

## 5. БД (Postgres 16)

`users(role) | threat_routing_rules | messages(status +IN_PROGRESS) | message_parsed_data |
message_attachments | message_links | message_threat_analysis(final_verdict) |
delivery_logs`. DDL — `V1__init.sql`, claim очереди — `V2__queue_claim.sql`,
роль — `V3__user_role.sql`, нормализованный текст — `V4__normalized_text.sql`
(`message_parsed_data.normalized_text`, пишется в `processOne` после enrich).
Сиды правил — `ON CONFLICT DO NOTHING`.
Фильтр `?category=` — подзапросом `EXISTS` на `final_verdict`
(в JPA связи `Message→analysis` нет).
Деталка `GET /messages/{id}` отдаёт инженерной шторке: `cleanText`,
`normalizedText`, `links[{url,status,reputationScore,details}]` (`details` —
распарсенный JSONB с `reasons`, битый — строкой как есть), `threat.spellerFixes`
(тоже распарсен, `parseJsonLenient`), `deliveries[]` из `delivery_logs`
(маршрут «кому предназначалось → куда ушло»).
Список несёт только лёгкий `attachmentCount` (BLOB-ы в список не тянуть),
полный `attachments[]` — только деталка.

## 6. Фронт (`frontend/`, уже в репо)

Next.js 14 App Router, Tailwind (+DaisyUI только в `/admin`).

- `/login` — регистрация `username+password → username@NEXT_PUBLIC_MAIL_DOMAIN`,
  вход по email; JWT в `localStorage` (MVP), роль из payload, 401 → `/login`.
- `/inbox` — Gmail-стиль: топбар с поиском (`?query=`, debounce 400мс),
  сайдбар (Входящие=`?recipient=я` / Отправленные=`?sender=я`), компактные строки
  (жирность=непрочитано из `localStorage`, ★ тоже там, красная точка=угроза,
  📎=вложения), пагинация стрелками `‹ ›` + `⟳`, polling 5с. Клик → экран чтения
  (статус-бейдж, вердикт-баннер, тело `pre-wrap`, чипы вложений → blob-скачивание,
  `⟳ Перепроверить`). Плавающее окно «Написать» (один `to`, CC/BCC нет;
  `\n→<br/>` + escape — бэк шлёт `setText(html=true)`; файлы ≤20МБ, иначе
  клиентский отказ).
- `/admin` (роль `ADMIN`, иначе 403-панель) — SOC-таблица `?status=REROUTED`
  (+ фильтр `?category=`), polling 10с + инженерная шторка: `<mark>` триггеров,
  таблица спеллера `было→стало`, `normalizedText`, карточки ссылок
  (статус+Threat Score+`reasons`), `explanation`, маршрут `deliveries[]`.
- API идёт через same-origin прокси `/backend/* → BACKEND_URL/api/*`
  (`next.config.js rewrites`) — CORS на бэке не нужен. В compose
  `BACKEND_URL=http://gateway:8080`.
- `Dockerfile.dev` (hot-reload, `:3008`) / `Dockerfile.prod` (standalone SSR),
  `next.config.js: {output:'standalone'}`. Проверка: `npm run typecheck`,
  `npm run lint`, `npm run build`.
- Ограничения MVP (зафиксированы): метки read/star — `localStorage`
  (`sm_read/sm_star`, один ящик на браузер); без удаления (нет эндпоинта);
  список бэка не скоупит по владельцу — любой залогиненный видит чужие письма
  (настоящая изоляция — отдельная задача).

## 7. Docker / Env

`docker-compose.yml`: `postgres, ml-parser, ml-enrich, ml-classify, gateway, mailhog, frontend, nginx`.
Переменные — `.env.example`: `MAIL_DOMAIN, POSTGRES_*, *_URL, JWT_SECRET,
POSTGRES_HOST_PORT, GATEWAY_HOST_PORT, NGINX_HTTP_PORT, NGINX_HTTPS_PORT,
BACKEND_URL, NEXT_PUBLIC_MAIL_DOMAIN`.
Хост-порты наружу параметризованы (`5432/8080/80/443` по умолчанию) — внутри сети
всё ходит по стандартным портам.
`nginx` (:80→301, :443 TLS) — терминация HTTPS перед `frontend`
(`client_max_body_size 25m`, HMR-websocket проксируется); серты —
самоподпись OpenSSL via `nginx/gen-certs.sh` (`CN=localhost`,
`SAN: localhost, *.corp-sec.ru, 127.0.0.1`), ключ только на хосте
(`nginx/certs/` в `.gitignore`, в репо не коммитить).
`mailhog` (:1025 SMTP, :8025 веб) — MVP-relay: сюда уходят чистые письма
и карантин (`MAIL_RELAY_HOST=mailhog`). Без relay доставка падает в `FAILED`.
В песочнице без сети `docker build` может не тянуть PyPI — это ок,
код от этого не меняется.

## 8. Команды

```bash
cp .env.example .env
docker compose config --quiet
# Python (нужны fastapi/pydantic/httpx/uvicorn на хосте):
python3 -c "import sys; sys.path.insert(0,'ml-classify'); from app.main import run_startup_tests; run_startup_tests()"
# Java:
cd gateway-java && mvn -q -DskipTests compile
mvn test  # юнит-тесты без БД (зелёные всегда); GatewayApplicationTests
          # требует живой PG (SPRING_DATASOURCE_URL/USERNAME/PASSWORD),
          # без него пропускается через @EnabledIfPostgresAvailable
# Сквозной прогон сценариев А+Б без фронта (нужен поднятый стенд):
./e2e_test.sh  # register×2 → send с PDF → DELIVERED+скачивание → SMTP-угроза
               # с обфускацией → REROUTED+карантин+проверка отсутствия утечки
```

## 9. Что нельзя ломать агенту

1. Чистая почта уходит без изменений; блокируется только `!= NONE`.
2. Порядок пайплайна: парсинг раньше эвристики/SLM.
3. Лимит 4 ГБ RAM для модели; fallback обязан работать без GGUF-файла.
4. Порты и очередь (`2525/2587`, `SKIP LOCKED`, `BYTEA`-вариант А).
5. Безопасность: BCrypt, JWT на `/messages/**`, `/admin` отдельно.
6. Документацию по контрактам обновлять вместе с кодом.
