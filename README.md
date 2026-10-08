# SafeMail — SMTP-шлюз с ИИ-фильтром

Мультиагентная асинхронная система фильтрации почты на enterprise-стеке
(Spring Boot, PostgreSQL, FastAPI, Next.js, Docker), рассчитанная на высокую
нагрузку и безопасность. Каждое письмо **асинхронно проходит 3 независимых
фильтра-агента** — и только их общий вердикт решает судьбу письма:

1. **Агент-парсер** (`ml-parser`) — извлекает текст, вложения и ссылки, сканирует
   вложения на исполняемый/вредоносный контент;
2. **Агент-обогатитель** (`ml-enrich`) — снимает маскировку (транслит, zero-width,
   смешанный алфавит, чужая раскладка), оценивает репутацию ссылок;
3. **Агент-классификатор** (`ml-classify`) — выносит вердикт по 4 категориям угроз
   (эвристика + управляемые стоп-слова + SLM).

Асинхронность: SMTP-сессия только принимает письмо и кладёт в очередь
(PostgreSQL + `SKIP LOCKED`) — ответ отправителю мгновенный, тяжёлый проход
по агентам идёт в фоне. Очередь допускает параллельных воркеров, агенты
масштабируются независимо друг от друга. Упавший агент не роняет приём:
конвейер деградирует во fallback, а не в отказ.

Шлюз стоит в цепочке `антиспам → SafeMail → почтовый сервер` и решает
**Задание 1.1**: разработка фильтра SMTP-трафика на основе искусственного
интеллекта, который определяет угрозы, извлекает их и перенаправляет по
заранее заданным адресам.

## Как задание закрывается кодом

| Пункт задания 1.1 | Реализация |
|---|---|
| 1) Угрозы террористического характера | `ThreatCategory.TERRORISM` — прототипы/стоп-слова/эвристика (`ml-classify`) |
| 2) Угрозы аварий техногенного характера | `ThreatCategory.MAN_MADE` |
| 3) Угрозы противоправных действий | `ThreatCategory.ILLEGAL_ACTIONS` |
| 4) Иные угрозы, не подходящие под 1–3 | `ThreatCategory.OTHER_THREAT` (+ чистый мат без маркеров → `OTHER_THREAT 0.75`, опасное вложение при чистом тексте → `OTHER_THREAT 0.85`) |
| «Перенаправлять по заранее указанным адресам» | Таблица `threat_routing_rules` (СИДы по 4 категориям) → копия заключения уходит на адреса ИБ, оригинал получателю **не доставляется** |
| «Вся остальная почта — до адресата без изменений» | Чистое (`NONE`) уходит **оригинальными байтами** (`sendOriginalBytes`), статус `DELIVERED` |
| «SMTP-шлюз между антиспамом и почтовым сервером» | SubEthaSMTP `:2525` (в проде `:25`) принимает, `JavaMailSender` отдаёт дальше через relay |

Статусы писем: `PENDING → IN_PROGRESS → PARSED → ENRICHED → ANALYZED → DELIVERED / REROUTED / FAILED`;
`FORWARDED` — вручную отправлено безопасникам, `DELIVERED` после выпуска из карантина.

## Архитектура

```
                    ┌─────────────┐
                    │  Антиспам   │──┐
                    └─────────────┘  │ :2525 (прод :25)
                                     ▼
┌──────┐  :2587(subm)  ┌──────────────────────┐   HTTP    ┌────────────┐
│ Юзер │──────────────▶│  gateway-java (8080) │──────────▶│ ml-parser  │ :8001
└──────┘               │  SubEthaSMTP + REST  │──────────▶│ ml-enrich  │ :8002
                       │  PostgreSQL-очередь  │──────────▶│ ml-classify│ :8003
                       └──────────┬───────────┘           └────────────┘
                                  │ relay (1025/mailhog в dev)
                                  ▼
                          получатель / ИБ-адреса
```

- **gateway-java** — Spring Boot 3.2, Java 21, приём SMTP + REST + поллер очереди.
- **ml-parser** — извлечение текста, вложений, ссылок из EML.
- **ml-enrich** — спеллер/деобфускация (zero-width, латиница+кириллица, раскладка) + скоринг ссылок.
- **ml-classify** — вердикт: управляемые стоп-слова (`threat_stopwords`) + эвристика + SLM-hook.
- **frontend** — Next.js 14: `/inbox` (ящик), `/admin` (SOC-карантин/обзор/настройки).
- **Очередь без Kafka**: `status='PENDING'` + `FOR UPDATE SKIP LOCKED`, claim в `IN_PROGRESS`, зависшие (>30 мин) возвращаются в `PENDING`. Поллинг каждые 5 с.
- **Hairpin**: получатель на `MAIL_DOMAIN` → внутрь пайплайна; чужой домен → сразу в relay без ИИ.
- **Хранение (вариант А)**: сырой EML и вложения — `BYTEA` в Postgres (одно вложение ~до 20 МБ).

## Алгоритмы конвейера

1. **Парсинг** (`POST /internal/parse-extract`): текст тела + текст вложений
   (PDF через `pypdf`, OOXML/ODF через stdlib-zip) + ссылки. Всё входит в анализ —
   угроза внутри PDF/DOC ловится.
2. **Скан вложений**: exe-расширения, двойные расширения (`pdf.exe`), макросы VBA,
   JS/Launch в PDF, скрипты в HTML, exe в zip. Порог `risk_score ≥ 70` → `is_dangerous`
   (наивный `/OpenAction [page /Fit]` без JS/Launch — не угроза, покрыто стартап-тестом).
3. **Обогащение** (`POST /internal/normalize-enrich`): снятие zero-width (`U+200B/C/D`,
   `U+FEFF`, счётчик `hidden_chars_removed` → флаг `hidden-chars:N`), спеллер
   (`source`: `yandex` | `mixed-alphabet` | `layout`), скоринг ссылок
   (IP +50, чёрный список +30/+15, без TLS +10). URL не транслитерируется.
4. **Классификация** (`POST /internal/classify-threat`): вход —
   `subject + cleanText + attachments`; сначала стоп-слова (подстрока по
   нормализованному тексту, первое совпадение → категория правила, `confidence 0.9`,
   флаг `stopword:<pattern>`), затем эвристика + SLM. Направленный мат/оскорбления
   без других маркеров → `OTHER_THREAT 0.75`.
5. **Роутер**: `NONE` → `deliverOriginal` (байт-в-байт) → `DELIVERED`;
   иначе → официальное «ЗАКЛЮЧЕНИЕ ШЛЮЗА СЕЙФМЕЙЛ № \<id\>» (5 этапов в порядке
   пайплайна) на адреса правила категории → `REROUTED`. При недоступности ML —
   fallback, SMTP-сессия не страдает (тяжёлое — в поллере).

**SLM**: лимит 4 ГБ RAM; прототип — `rubert-tiny2` (ONNX, ~116 МБ, ~1 мс),
порог `0.65`, маржа `0.05`, `fuse_verdict` обратно совместим. Без файла модели
работает rule-based fallback (зафиксировано).

## Принятые решения (суть)

- Чистое — без изменений; блокируется только `!= NONE`. Порядок «парсинг раньше эвристики/SLM» не ломать.
- Карантин **невидим получателю**: `mailbox=inbox` вырезает `REROUTED`/`FORWARDED`, деталка и скачивание вложений из карантина для не-`ADMIN` — 404 тем же телом, что для несуществующего.
- Выпущенное из карантина (`RELEASED_BY_ADMIN` в аудите) получатель видит с нейтральным «Проверено шлюзом», красный баннер — только в шторке `/admin`.
- Форвард безопасникам — одноразовый (только из `REROUTED`, повтор — 400).
- Тема чинится `decodeSubject` (RFC2047 + mojibake Latin-1→UTF-8, тест `SubjectDecodeTest`).
- Hibernate 6: claim/reset очереди — только native `CAST('X' AS message_status)`, bulk-HQL с enum запрещён.
- Яндекс-спеллер шлёт наружу первые 20 слов текста — для прода с ПДн это вопрос 152-ФЗ (флаг отключения запланирован, по умолчанию включён).
- Прод: overlay `docker-compose.prod.yml` (25/587 наружу, standalone-фронт, MailHog только по `--profile debug`), TLS через nginx, серты самоподписью (`gen-certs.sh`, в репо не коммитятся).

## Запуск (локально)

```bash
cp .env.example .env
docker compose up -d --build
./e2e_test.sh   # 13 сквозных сценариев: register → PDF → DELIVERED → SMTP-угроза → REROUTED
```

Фронт: `http://localhost:3008` (`/login`, `/inbox`, `/admin`), MailHog-веб `:8025`.
MVP-админ: `admin@<MAIL_DOMAIN>` / `APP_ADMIN_PASSWORD` (дефолт `admin` — сменить в проде).

## Стенд хакатона (только приём, VPS + домен)

```bash
# DNS: A mail.<домен> → IP VPS; MX @ → mail.<домен>.
# На VPS: 25-й порт открыт, Docker стоит.
git clone https://github.com/Maxim-5GHZ/SafeMail.git
cp .env.example .env   # MAIL_DOMAIN=<домен>, стойкие JWT_SECRET/POSTGRES_PASSWORD/APP_ADMIN_PASSWORD
./nginx/gen-certs.sh   # или настоящий серт в nginx/certs/
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile debug up -d --build
```

Проверка: `telnet localhost 25` → баннер SubEthaSMTP; письмо с Gmail на `user@<домен>` →
инбокс (чистое) или `/admin` (угроза). Детали — `docs/PROD.md`.
Исходящее наружу в этом режиме оседает в MailHog (внешний auth-релей не подключён —
сознательное упрощение под хак, спам-доставляемость не требуется).

## Проверки перед демо

```bash
cd gateway-java && mvn test                                        # 60 тестов, без БД
cd frontend && npm run typecheck && npm run lint && npm run build  # чисто
python3 -c "import sys; sys.path.insert(0,'ml-classify'); from app.main import run_startup_tests; run_startup_tests()"
```

## Структура

```
gateway-java/   Spring Boot: smtp/, service/ (InboundPipelineService, MailRoutingService,
                MessageService, AuthService), controller/, security/, domain/, repository/
ml-parser/      FastAPI :8001 — parse-extract
ml-enrich/      FastAPI :8002 — normalize-enrich
ml-classify/    FastAPI :8003 — classify-threat (+ SLM-прототип)
frontend/       Next.js 14: app/(login,inbox,admin), lib/ (api, labels, auth), components/
nginx/          TLS-терминация + gen-certs.sh
docs/PROD.md    приём почты из интернета (MX/порт 25/окружение)
e2e_test.sh     сквозной прогон сценариев А+Б
```
