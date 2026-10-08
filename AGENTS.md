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
`ILLEGAL_ACTIONS`, `OTHER_THREAT`. Статусы писем: `PENDING,IN_PROGRESS,PARSED,
ENRICHED,ANALYZED,DELIVERED,REROUTED,FORWARDED,FAILED` (`FORWARDED` — вручную
отправлено безопасникам, получатель оригинала его не видел; `V6`).

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
  возвращаются в `PENDING` (`resetStale`). Поллинг каждые 5 с, batch до 10
  раздаётся по пулу `pipelineExecutor` (4/8, `GatewayConfig`) — каждое письмо
  в своей транзакции, claim атомарный, head-of-line blocking нет.
  `triggerReprocessing` после коммита сразу ставит письмо в тот же пул
  (`afterCommit → processClaimed`), не ждёт следующего полла.
  Один `RCPT TO` = одна строка `messages` (мультиполучатели размножаются
  в `InboundMessageHandlerFactory`).
- Hairpin (`MailRoutingService`): получатель на своём домене
  (`SystemSettingService.isLocalDomain`, основной + алиасы) → внутрь
  пайплайна; чужой домен → сразу в relay без ИИ.
- SLM-лимит: **4 ГБ RAM**. `ml-classify`: `rubert-tiny2` (ONNX, 116 МБ, CPU,
  ~222 МБ RAM), веса запечены в образ (multi-stage Dockerfile: stage 1 экспортирует
  через torch+optimum, в рантайме только `numpy/onnxruntime/transformers`).
  `fuse_verdict`: эвристика главная (stopword или `≥0.75` побеждает), семантика ловит
  парафразы при `NONE` (`TH=0.65`, `MARGIN=0.05`, флаг `semantic:<cat>:<score>`).
  Вето: слабый сигнал (`<0.75`, без stopword/profanity) гасится разборчивым `NONE`
  семантики (`available` + sem `NONE` + none-скор `≥0.85`, `VETO_NONE_MIN`,
  флаг `semantic-veto:<cat>:<score>`); raw у нормы по промпту всегда низкий
  (~0.05) и в пороге не участвует. Без ключа/сети fallback (`0.0/0.0`,
  safety-блок, мусор) порог не проходит — fail-closed.
  Сборке нужен интернет (HF в stage 1); без сети собирать из кэша — иначе только fallback.
  Комментарий SLM (`semantic_comment` из `classify-threat`, колонки `V7`) —
  только в шторке `/admin` (получателю не виден); у старых писем NULL.
  Формат: одна строка, категории по-русски (`RU_CATEGORY`), ниже порога —
  честно «на вердикт не повлияло», а не «видит»; бар модели в шторке —
  сырой `semanticScore` и только при её категории (иначе `confidence` врёт).

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
    AuthService.java             # register username→email@primaryDomain (настройки), BCrypt+JWT
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
  карантинная — официальное «ЗАКЛЮЧЕНИЕ ШЛЮЗА СЕЙФМЕЙЛ № <id>»
  (`buildQuarantineBody`, 5 этапов строго в порядке пайплайна: приём →
  спеллер с источниками → деобфускация → ссылки словами → вердикт;
  в тексте прямо сказано, что спеллер раньше алгоритмов, иначе маскировка
  прячет угрозу) + `delivery_logs`.

## 4. Python ML (`ml-parser/`, `ml-enrich/`, `ml-classify/`)

FastAPI, контракты — `POST /internal/*`, `GET /health`. Стиль: маленькие
модули, `pydantic`-модели запросов, без тяжёлых зависимостей
(`requirements.txt`: `fastapi, uvicorn(без [standard]), httpx|multipart`).

- **parser** `POST /internal/parse-extract {raw_base64}` →
  `{clean_text, extracted_attachments_text, attachments[{filename,content_type,size,content_base64,
  extracted_text,is_dangerous,risk_score,risk_reasons[]}], links[{url}]}`.
  Текст вложений (PDF через `pypdf`, OOXML/ODF через stdlib-zip, plain/html — декодированием)
  идёт в `extracted_attachments_text` и входит в enrich/classify-вход — угроза внутри
  PDF/DOC ловится. Скан вложений: exe-расширения, двойные расширения (`pdf.exe`),
  макросы VBA (`vbaProject.bin` в zip), JS/Launch/Embedded в PDF, скрипты в HTML,
  exe внутри zip (`risk_reasons`, `is_dangerous` при `risk_score>=70`).
  Безобидный `/OpenAction [page /Fit]` навигации — не угроза (только в связке с JS/Launch,
  иначе fpdf2/Word-PDF уходили бы в карантин — регрессия покрыта startup-тестом).
  Gateway: опасное вложение при чистом тексте эскалирует вердикт до `OTHER_THREAT 0.85`
  (флаги `attachment:<reason>`), `message_attachments.is_threat=true`; деталка отдаёт
  `attachments[{id,filename,sizeBytes,contentType,threat}]`, скачивание —
  `GET /messages/{id}/attachments/{attId}` (доступно и из карантина в шторке).
- **enrich** `POST /internal/normalize-enrich {text, urls}` →
  `{normalized_text, speller_fixes[{original,suggested,source}], links[{url,is_phishing,risk_score}], hidden_chars_removed}`.
  URL транслитерировать **запрещено** (резать текст по URL, нормализовать
  только куски). `source`: `yandex` (внешний API, текст уходит наружу) |
  `mixed-alphabet` (латиница+кириллица в слове) | `layout` (строго: чисто
  латинский токен, осмысленный после EN→RU-перекладки — проверка точным
  вхождением в `COMMON_RU_WORDS`; английские слова не трогаем, они идут
  обычным транслитом; ограничение зафиксировано). Zero-width (`U+200B/C/D`,
  `U+FEFF`) режется сразу по всему тексту, счётчик — `hidden_chars_removed`,
  gateway дописывает флаг `hidden-chars:N` в `heuristic_flags`. Скоринг: IP +50, хит чёрного списка +30/+15, без TLS +10.
- **classify** `POST /internal/classify-threat {text, stopwords?[{pattern,category}]}` →
  `{category, confidence, explanation, heuristic_score, heuristic_flags,
  semantic_category, semantic_score, semantic_comment, model}`.
  Управляемые стоп-слова из PG (`threat_stopwords`): подстрока без учёта регистра
  по нормализованному тексту, первое совпадение → вердикт категории правила
  (`confidence 0.9`, флаг `stopword:<pattern>`; чужая/NONE-категория → `OTHER_THREAT`).
  Без ML стоп-слова не срабатывают (fallback отдаёт `NONE`) — ограничение зафиксировано.
  Внутри `ToxicityAndProfanityFilter.normalize/analyze`:
  склейка только `.-_*+` внутри слов (пробелы хранить!), `y→й`,
  safe-подстроки (`колебан, рубл, скипидар…`) не считать матом.
  Направленный мат/оскорбления без других маркеров — `OTHER_THREAT 0.75`
  (иначе «мат в теме при пустом теле» уходил `DELIVERED`).
  Семантика — `app/semantic.py`: Mistral через OpenRouter (primary,
  `OPENROUTER_API_KEY` + опц. `OPENROUTER_MODEL`, `httpx`, таймаут 8с) +
  GigaChat (fallback, `GIGACHAT_API_KEY`, таймаут ~5.5с). Пулы запросов 6+1
  (семафоры + keep-alive): каждый `explain()` сначала в Mistral, при падении —
  один заход в GigaChat; оба упали — `(NONE,0,0)` fail-closed. Падение Mistral
  логируется warning-строкой `mistral fallback -> gigachat | reason | ms`
  (без тел писем/ключей), исход — `gigachat fallback ok` / `both providers failed`;
  счётчики — в `GET /health.semantic`, провайдер — флагом `semantic-provider:*`.
  Кап генерации `MAX_TOKENS=300` (ответ — короткий JSON, запас 3x): обрезка даёт
  `non_json` → штатный fallback, а не неверный вердикт.
  Ключи только из `.env` (в репо — пустые плейсхолдеры `.env.example`).
- Startup-тесты (`run_startup_tests`, `lifespan`) обязаны проходить,
  иначе процесс падает с `exit 1`. Живые LLM-кейсы семантики — warn-only:
  категория-сосед на пограничной парафразе старт не валит (иначе внешний LLM
  кладёт сервис в crash-loop); фатальны детерминированные тесты
  (эвристика/вето/роутер/формат) и ложное срабатывание на чистых NONE-кейсах.
  Новое правило — сначала тест-кейс
  (прямой/транслит/обфускация/false-positive), потом код.

## 5. БД (Postgres 16)

`users(role) | threat_routing_rules | threat_stopwords | messages(status +IN_PROGRESS) | message_parsed_data |
message_attachments | message_links | message_threat_analysis(final_verdict) |
delivery_logs`. DDL — `V1__init.sql`, claim очереди — `V2__queue_claim.sql`,
роль — `V3__user_role.sql`, нормализованный текст — `V4__normalized_text.sql`
(`message_parsed_data.normalized_text`, пишется в `processOne` после enrich),
стоп-слова — `V5__threat_stopwords.sql` (`pattern UNIQUE, category, is_active` + сиды),
статус отправки безопасникам — `V6__message_status_forwarded.sql`
(`ALTER TYPE … ADD VALUE`, как `V2`).
Сиды правил — `ON CONFLICT DO NOTHING`.
Фильтр `?category=` — подзапросом `EXISTS` на `final_verdict`
(в JPA связи `Message→analysis` нет).
Админ-дашборд: `GET /api/v1/admin/stats?days=14` (только `ADMIN`,
`days 1..90`, иначе 400 через `GlobalExceptionHandler`):
`{total, byStatus, byCategory, byCategoryRerouted, byCategoryForwarded, perDay[{date,total,rerouted}], queue{pending,inProgress}}`.
`byStatus/byCategory` — за всё время (`GROUP BY`), `byCategoryRerouted` — вердикты только
писем в `REROUTED`, `byCategoryForwarded` — только `FORWARDED` (native `JOIN … WHERE status=CAST(…)`),
`perDay.rerouted` — весь карантинный трафик (`REROUTED+FORWARDED`, иначе отправленное исчезало бы из динамики).
Ручной выпуск: `POST /api/v1/admin/messages/{id}/release {reason?≤500}` (только `ADMIN`):
из `REROUTED`/`FORWARDED` (иначе 400), оригинал — исходному получателю, статус→`DELIVERED`,
вердикт сохраняется, в `delivery_logs` — `RELEASED_BY_ADMIN` с email админа и причиной.
Ручная отправка безопасникам: `POST /api/v1/admin/messages/{id}/forward {emails?[], reason?≤500}`
(только `ADMIN`): только из `REROUTED` (иначе 400, повтор из `FORWARDED` запрещён —
получатели = адреса правила категории вердикта + `emails` (дедуп, пусто всё → fallback `infosec@<domain>`);
содержимое — оригинал без изменений (только конверт получателей), статус→`FORWARDED`
(письмо уходит из карантина в отдельный фильтр), в `delivery_logs` — `FORWARDED_TO_SECURITY`.
Стоп-слова: `GET/POST /api/v1/admin/stopwords`, `PUT/DELETE /api/v1/admin/stopwords/{id}`
(только `ADMIN`; `pattern 2..200`, `category`, `active`).
Настройки почты: `GET /api/v1/public/config` (без авторизации: `primaryDomain`,
`allowedDomains` — живой домен для форм), `GET/PUT /api/v1/admin/settings`
(только `ADMIN`; `primaryDomain` обязателен, `allowedDomains[] ≤20`,
`relayPort 1..65535`; домены валидируются `SystemSettingService.normalizeDomain`).
`MAIL_DOMAIN` в env — обязателен (без него gateway fail-fast, дефолта-литерала
нет ни в коде, ни в compose — только значение из `.env`; пример дефолта живёт
исключительно в `.env.example`) и это сид при первом старте (`V8`,
`system_settings` id=1 + авто-алиас `mail.X ↔ X`); рантайм — из БД.
Смена домена (`PUT /admin/settings`) в той же транзакции пересаживает внутренние
адреса на новый primary (тот же local-part): `threat_routing_rules` + `users.email`;
внешние адреса и история писем — никогда; коллизия email — пропуск строки с отчётом.
Ответ несёт `rebasedRules/rebasedUsers/skippedUsers[]` (фронт показывает итог).
Сиды `V1` (`infosec@…` исторического домена) чинит при старте `RoutingRuleSeeder`
(только строки-остатки сида; ручные внешние адреса не трогает; цель — `ROUTE_*`
из env, иначе `infosec@<primary>`). Релей выключен (дефолт):
чистое письмо не пересылается, а хранится локально (`STORED_LOCALLY`, статус
`DELIVERED`); карантин/forward/release — тоже без SMTP (только аудит
`delivery_logs`). Фильтр `?recipient=` на своём домене ищет по всем алиасам
(`OR` точных совпадений), чужой — как раньше подстрокой.
Фронт `/admin`: KPI-карточки + чипы категорий
(клик — фильтр таблицы) + div-бары динамики + селектор 7/14/30д, polling 10с.
Деталка `GET /messages/{id}` отдаёт инженерной шторке: `cleanText`,
`normalizedText`, `links[{url,status,reputationScore,details}]` (`details` —
распарсенный JSONB с `reasons`, битый — строкой как есть), `threat.spellerFixes`
(тоже распарсен, `parseJsonLenient`), `deliveries[]` из `delivery_logs`
(маршрут «кому предназначалось → куда ушло»).
Список несёт только лёгкий `attachmentCount` (BLOB-ы в список не тянуть),
полный `attachments[]` — только деталка.

## 6. Фронт (`frontend/`, уже в репо)

Next.js 14 App Router, Tailwind (+DaisyUI только в `/admin`).

- `/login` — регистрация `username+password → username@<primaryDomain из /public/config>`,
  вход по email; JWT в `localStorage` (MVP), роль из payload, 401 → `/login`.
- `/` — полноэкранная презентация (6 слайдов: продукт/проблема/архитектура/
  аудитория/окупаемость/демо; скролл/стрелки/свайпы, `fadeIn` в `globals.css`,
  сегментные SVG-иконки в `components/icons.tsx` — эмодзи запрещены).
  Показывается всем, включая залогиненных; кнопка «В интерфейс/Войти» ведёт
  по роли (`homeForRole`: `ADMIN`→`/admin`, остальные→`/inbox`).
  Авторедиректа с корня больше нет.
  Показываемый домен — живой (`GET /public/config`), запечённый
  `NEXT_PUBLIC_MAIL_DOMAIN` — только фолбэк; тост в `/inbox` сверяет получателя
  с `allowedDomains` (алиасы), а не с одной строкой env.
- `/inbox` — Gmail-стиль: топбар с поиском (`?query=`, debounce 400мс),
  сайдбар (Входящие=`?recipient=я&mailbox=inbox` / Отправленные=`?sender=я&mailbox=sent`),
  компактные строки (жирность=непрочитано из `localStorage`, SVG-звезда тоже там, красная точка=угроза,
   SVG-скрепка=вложения), пагинация стрелками `‹ ›` + кнопка `Обновить`, polling 5с. Клик → экран чтения
   (статус-бейдж, вердикт-баннер, тело `pre-wrap`, чипы вложений → blob-скачивание,
   кнопка `Перепроверить`). Плавающее окно «Написать» (один `to`, CC/BCC нет;
  `\n→<br/>` + escape — бэк шлёт `setText(html=true)`; файлы ≤20МБ, иначе
  клиентский отказ).
- `/inbox` — бейджи статуса зависят от папки (`folderStatusLabel` в `labels.ts`):
  во Входящих `DELIVERED` — нейтральное «Получено» (адресат и есть читатель),
  в Отправленных — честно: «Доставлено получателю» / «На проверке шлюза» /
  «Заблокировано шлюзом» / «Не доставлено — ошибка». Деталка и список несут
  `lastError` (последний неуспешный `smtpResponse` из `delivery_logs`):
  FAILED-строки в Отправленных красные с причиной в тултипе, в деталке —
  красный бокс. Тост после `202`: своему домену — «Принято — идёт проверка
  шлюза» (вердикт позже), наружу — «Письмо отправлено». SMTP-таймауты релея
  (`connectiontimeout 5с / timeout 10с`) — мёртвый relay даёт быструю 500
  с текстом, а не виснет. Пустое тело с вложениями — «Текста нет — только
  <имя> (размер)», в списке — «Вложение: N шт.». Карантин получателю невидим:
  `mailbox=inbox` вырезает `REROUTED`/`FORWARDED` из списка (тихо, без заглушек),
  деталка и скачивание вложений из карантина для не-`ADMIN` — 404 тем же телом,
  что для несуществующего (факт блокировки не палится); исключение — отправитель
  своего письма (`senderStrippedDetails`): текст и файлы — да, но без вердикта,
  разбора, `normalizedText`/EML, скоринга ссылок и маршрута ИБ; вердикт в списке
  — только `ADMIN` (фронт null-safe: точки/баннера нет). Отправитель карантин
  в «Отправленных» видит, админ — в `/admin`. В `ReaderView` 404 — терминальное
  состояние (polling стопается, вечной «Загрузки…» нет). Шторка после
  release/forward закрывается (`onResolved`: forward→ящик `FORWARDED`,
  фильтры/страница не сбрасываются; `onReprocessed` — только «Перепроверить»). Выпущенное из карантина письмо
  (`DELIVERED` + вердикт + `RELEASED_BY_ADMIN` в `delivery_logs`) получатель
  видит с нейтральным «Проверено шлюзом — выпущено администратором», красный
  баннер угрозы ему не показывается (вердикт — только в шторке `/admin`).
  Тема чинится `decodeSubject` (RFC2047 + mojibake Latin-1→UTF-8, регрессия —
  `SubjectDecodeTest`), иначе сырой UTF-8 в заголовке даёт кракозябры.
- `/admin` (роль `ADMIN`, иначе 403-панель) — три вкладки: `Карантин` (дефолтная,
  два ящика `REROUTED`/`FORWARDED` со счётчиками + чипы категорий активного ящика
  (`byCategoryRerouted`/`byCategoryForwarded`) + таблица + пагинация, polling 10с) /
   `Обзор` (KPI: всего/доставлено/карантин/отправлено в ИБ/ошибки/очередь + график
  с осью/легендой/min-height сегментов, скелетоны вместо нулей, селектор 7/14/30д) /
   `Настройки` (стоп-слова CRUD + «Адреса ИБ» `GET/PUT /routing-rules`
   + «Почтовый домен и приём писем» `GET/PUT /admin/settings`: основной домен,
   алиасы, вкл/выкл релея — применяется сразу, без пересборки).
  Тон `/admin` — нейтральный SOC: цвет только маркером серьёзности
  (`severityOf/severityDotClass` в `labels.ts`: красный/оранжевый/янтарный/серый),
  фиолетовый акцент сохранён; сводка письма — панель с полосой severity,
  этапы отчёта — нумерованные маркеры, артефакты — моно (`soc-*` в `globals.css`).
   Инженерная шторка следит за письмом между ящиками (forward переключает вкладку),
   бейдж статуса: `В карантине`/`Отправлено в ИБ`; выпуск активен в обоих ящиках
   (из `FORWARDED` тоже разрешён, в UI кнопка требует причину — бэк принимает и без неё),
   кнопка форварда — только в `REROUTED` (одноразовый,
   повтор бэк режет 400). Подписи кодов — `frontend/lib/labels.ts` (категории, статусы,
   ссылки, причины, флаги, маршрут + `spellerSourceLabel`: Яндекс/смешанный алфавит/раскладка);
   шторка — карточка инцидента SOC-стиля: вердикт сверху (категория + ML-скор/эвристика +
   сигнатуры), паспорт конверта, конвейер нормализации с переключателем
   «Деобфусцированный/Исходный (RAW)», IoC-блок ссылок, таймлайн аудита, липкая панель
   действий; тема только светлая (`light`, `dark:`-классы запрещены — иначе при тёмной
   ОС шторка уйдёт в тёмную, а остальное нет); эмодзи запрещены — значки только SVG
   (`components/icons.tsx`);    бренд в UI — `СейфМейл` + векторный логотип `components/Logo.tsx`
   (`LogoMark` в шапках, `LogoFull` на `/login`, фавикон `app/icon.svg`); тело карантина — `Номер письма`
   вместо `Message-ID`.
- API идёт через same-origin прокси `/backend/* → BACKEND_URL/api/*`
  (`next.config.js rewrites`) — CORS на бэке не нужен. В compose
  `BACKEND_URL=http://gateway:8080`.
- `Dockerfile.dev` (hot-reload, `:3008`) / `Dockerfile.prod` (standalone SSR),
  `next.config.js: {output:'standalone'}`. Проверка: `npm run typecheck`,
  `npm run lint`, `npm run build`. Хостовая сборка перетирает bind-mounted
  dev-кэш `./frontend/.next` → dev-сервер в контейнере падает с 500
  (`MODULE_NOT_FOUND _document`): после `npm run build` делать
  `rm -rf ./frontend/.next && docker compose restart frontend`.
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
(`client_max_body_size 25m`, HMR-websocket проксируется); апстрим — через
переменную (`resolver 127.0.0.11` + `proxy_pass http://$upstream_frontend`),
а не блок `upstream`: иначе либо emerg `may not have port` (порт на имени
группы запрещён), либо `host not found` при старте раньше фронта; серты —
самоподпись OpenSSL via `nginx/gen-certs.sh` (`CN=localhost`,
`SAN: localhost, *.corp-sec.ru, 127.0.0.1`), ключ только на хосте
(`nginx/certs/` в `.gitignore`, в репо не коммитить).
`frontend` бежит под `user: "${UID:-1000}:${GID:-1000}"` — иначе root-писанина
dev-сервера в `./frontend/.next` ломает хостовые `npm run build/typecheck` (EACCES).
`mailhog` (:1025 SMTP, :8025 веб) — MVP-relay для исходящих наружу
(`MAIL_RELAY_HOST=mailhog`). Входящие из интернета релея НЕ требуют:
при выключенном реле (дефолт) чистые письма хранятся локально
(`STORED_LOCALLY`, статус `DELIVERED`), карантин — тоже локально.
Прод — overlay `docker-compose.prod.yml`
(`-f docker-compose.yml -f docker-compose.prod.yml up -d --build`):
реальные `25:2525`/`587:2587` наружу, фронт из `Dockerfile.prod` (standalone,
`PORT=3008` под nginx upstream, `volumes: !reset []` + `user: "0:0"` — иначе
dev-маунт `./frontend:/app` из базы перекрывает запечённый `server.js`
и фронт падает `MODULE_NOT_FOUND`; `BACKEND_URL`/`NEXT_PUBLIC_MAIL_DOMAIN` —
`build.args`, т.к. rewrites и `NEXT_PUBLIC_*` запекаются в `next build`), mailhog только по профилю
`debug`, relay — через `MAIL_RELAY_HOST/PORT` из `.env`. Приём из интернета
(Gmail→шлюз): MX/A-записи + открытый 25-й порт у хостера — см. `docs/PROD.md`.
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
