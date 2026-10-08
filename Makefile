# SafeMail — короткие команды вместо длинных docker/mvn/npm строк.
# Полный контракт — AGENTS.md §8. Использование: `make help`.
#
# Переменные окружения читаются из .env (compose) — Makefile их не дублирует.

COMPOSE := docker compose
PROD := -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help env config
help: ## Показать все цели
	@grep -E '^[a-z0-9-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS=":.*?## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## Создать .env из примера, если его нет
	@test -f .env || cp .env.example .env

config: ## Проверить оба compose-файла (dev + prod overlay)
	@$(COMPOSE) config --quiet && $(COMPOSE) $(PROD) config --quiet && echo OK

# --- Стенды ---------------------------------------------------------------

.PHONY: up up-build down restart logs ps clean-next
up: ## Dev-стенд в фоне
	@$(COMPOSE) up -d

up-build: ## Dev-стенд в фоне с пересборкой
	@$(COMPOSE) up -d --build

down: ## Остановить dev-стенд (данные в volume целы)
	@$(COMPOSE) down

restart: ## Перезапустить всё (после правок .env без пересборки)
	@$(COMPOSE) restart

logs: ## Хвост логов всего стенда
	@$(COMPOSE) logs --tail=50 -f

ps: ## Статус контейнеров
	@$(COMPOSE) ps

clean-next: ## Вылечить упавший dev-фронт после хостового npm run build
	rm -rf ./frontend/.next && $(COMPOSE) restart frontend

.PHONY: prod-up prod-debug prod-down
prod-up: ## Прод-оверлей в фоне с пересборкой (mailhog НЕ стартует)
	@$(COMPOSE) $(PROD) up -d --build

prod-debug: ## Прод-оверлей + mailhog (приём чистой почты без релея = FAILED без него)
	@$(COMPOSE) $(PROD) --profile debug up -d --build

prod-down: ## Остановить прод-стенд
	@$(COMPOSE) $(PROD) down

# --- Проверки -------------------------------------------------------------

.PHONY: test test-java test-py test-front e2e
test: test-java test-py test-front ## Все проверки: java + python-стартап + фронт

test-java: ## Юнит-тесты gateway (без БД; PG-тест сам пропускается)
	@cd gateway-java && mvn -q test

test-py: ## Стартап-тесты трёх ML-сервисов (падают — процесс не стартует)
	@python3 -c "import sys; sys.path.insert(0,'ml-parser'); from app.main import run_startup_tests; run_startup_tests()" && \
	 python3 -c "import sys; sys.path.insert(0,'ml-enrich'); from app.main import run_startup_tests; run_startup_tests()" && \
	 python3 -c "import sys; sys.path.insert(0,'ml-classify'); from app.main import run_startup_tests; run_startup_tests()"

test-front: ## typecheck + lint фронта
	@cd frontend && npm run typecheck && npm run lint

e2e: ## Сквозной прогон сценариев А+Б (нужен поднятый стенд)
	@./e2e_test.sh

.PHONY: no-hardcode
no-hardcode: ## Контроль: захардкоженного активного домена нет (допустимы сид V1 и примеры)
	@! grep -rn "corp-sec" gateway-java/src/main frontend/app frontend/lib frontend/Dockerfile.prod docker-compose.yml docker-compose.prod.yml --exclude-dir=node_modules | grep -v "LEGACY_SEED_DOMAIN\|V1__init" || (echo "HARDCODE FOUND"; exit 1)
	@echo OK
