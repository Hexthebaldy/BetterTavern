SERVER := apps/server
MOBILE := apps/mobile
COMPOSE := docker compose -f deploy/docker-compose.dev.yml
TEST_DB := postgresql://bettertavern:bettertavern@localhost:5432/bettertavern

.PHONY: install dev worker migrate db-up db-down test test-integration lint fmt mobile-install mobile-test eval-director

install:
	cd $(SERVER) && uv sync

dev:
	cd $(SERVER) && uv run bettertavern serve --reload

worker:
	cd $(SERVER) && uv run bettertavern worker

migrate:
	cd $(SERVER) && uv run bettertavern migrate

db-up:
	$(COMPOSE) up -d postgres

db-down:
	$(COMPOSE) down

test:
	cd $(SERVER) && uv run pytest

test-integration:
	cd $(SERVER) && BT_TEST_DATABASE_URL=$(TEST_DB) uv run pytest -m integration

lint:
	cd $(SERVER) && uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run lint-imports --config importlinter.ini

fmt:
	cd $(SERVER) && uv run ruff format . && uv run ruff check --fix .

mobile-install:
	cd $(MOBILE) && npm install && npm run setup

mobile-test:
	cd $(MOBILE) && npm test

eval-director:
	cd $(SERVER) && uv run python -m evals.director_compliance $(ARGS)
