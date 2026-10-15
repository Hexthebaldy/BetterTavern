SERVER := apps/server
MOBILE := apps/mobile
WEB := apps/web
VIS := apps/vis
COMPOSE := docker compose -f deploy/docker-compose.dev.yml
TEST_DB := postgresql://bettertavern:bettertavern@localhost:5432/bettertavern

.PHONY: install dev worker migrate db-up db-down test test-integration lint fmt js-install js-test js-typecheck mobile-install web web-build web-e2e vis-install vis vis-test eval-director

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

# 前端是一个 npm 工作区（根目录 package.json）：apps/mobile、apps/web 和 packages/*，依赖装在根目录
js-install:
	npm install

js-test:
	npm test

js-typecheck:
	npm run typecheck

mobile-install: js-install
	cd $(MOBILE) && npm run setup

# 网页端的开发服务器（http://localhost:5173），接口转给 http://localhost:8000
web:
	cd $(WEB) && npm run dev

# 网页端的生产构建（apps/web/dist），部署方式见 deploy/nginx.example.conf
web-build:
	cd $(WEB) && npm run build

# 网页端的端到端测试：自己起后端、假模型服务和 Vite，用本机的 Chrome
web-e2e:
	cd $(WEB) && npm run e2e

vis-install:
	cd $(VIS) && npm install

vis:
	cd $(VIS) && npm run build
	cd $(SERVER) && uv run bettertavern vis

vis-test:
	cd $(VIS) && npm test

eval-director:
	cd $(SERVER) && uv run python -m evals.director_compliance $(ARGS)
