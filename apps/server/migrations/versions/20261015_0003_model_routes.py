"""凭据并进模型路由：一行就是一个配好的模型（Key、端点、模型名、窗口、写法设置）

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-15

删掉 credentials 和旧的 model_routes（数据不迁移，升级后重新添加模型），新建 model_routes。
迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

DDL = """
DROP TABLE model_routes;
DROP TABLE credentials;

CREATE TABLE model_routes (
    id                 UUID PRIMARY KEY,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label              TEXT NOT NULL DEFAULT '',
    provider           TEXT NOT NULL,
    base_url           TEXT,
    api_key_enc        TEXT NOT NULL,
    key_id             TEXT NOT NULL,
    key_last4          TEXT NOT NULL DEFAULT '',
    extra_headers_enc  TEXT,
    extra_body         JSONB NOT NULL DEFAULT '{}'::jsonb,
    model              TEXT NOT NULL,
    listed_window      INTEGER CHECK (listed_window > 0),
    manual_window      INTEGER CHECK (manual_window > 0),
    learned_window     INTEGER CHECK (learned_window > 0),
    params             JSONB NOT NULL DEFAULT '{}'::jsonb,
    caps_override      JSONB NOT NULL DEFAULT '{}'::jsonb,
    probe              JSONB NOT NULL DEFAULT '{}'::jsonb,
    status             TEXT NOT NULL DEFAULT 'unverified'
                       CHECK (status IN ('unverified', 'ok', 'invalid')),
    last_ok_at         TIMESTAMPTZ,
    is_director        BOOLEAN NOT NULL DEFAULT false,
    fallback_route_id  UUID REFERENCES model_routes(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX model_routes_user_idx ON model_routes (user_id, created_at);
CREATE UNIQUE INDEX model_routes_director_uq ON model_routes (user_id) WHERE is_director;
"""

# 回到 0002 的两张表（空表）
DOWN = """
DROP TABLE model_routes;

CREATE TABLE credentials (
    id                 UUID PRIMARY KEY,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    label              TEXT NOT NULL,
    base_url           TEXT,
    api_key_enc        TEXT NOT NULL,
    key_id             TEXT NOT NULL,
    key_last4          TEXT NOT NULL DEFAULT '',
    extra_headers_enc  TEXT,
    extra_body         JSONB NOT NULL DEFAULT '{}'::jsonb,
    probed             JSONB NOT NULL DEFAULT '{}'::jsonb,
    status             TEXT NOT NULL DEFAULT 'unverified'
                       CHECK (status IN ('unverified', 'ok', 'invalid')),
    last_ok_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credentials_user_idx ON credentials (user_id, created_at);

CREATE TABLE model_routes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playthrough_id     UUID REFERENCES playthroughs(id) ON DELETE CASCADE,
    task               TEXT NOT NULL CHECK (task IN ('director', 'state_keeper', 'outline',
                                                     'compactor', 'gate', 'world_builder',
                                                     'repair')),
    credential_id      UUID NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    model              TEXT NOT NULL,
    params             JSONB NOT NULL DEFAULT '{}'::jsonb,
    caps_override      JSONB NOT NULL DEFAULT '{}'::jsonb,
    fallback_route_id  UUID REFERENCES model_routes(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX model_routes_user_task_uq ON model_routes (user_id, task)
    WHERE playthrough_id IS NULL;
CREATE UNIQUE INDEX model_routes_pt_task_uq ON model_routes (playthrough_id, task)
    WHERE playthrough_id IS NOT NULL
"""


def statements(ddl: str) -> list[str]:
    """拆成单条语句：asyncpg 走预编译语句，一次只能执行一条。DDL 里不出现字符串内的分号。"""
    return [part.strip() for part in ddl.split(";") if part.strip()]


def upgrade() -> None:
    for statement in statements(DDL):
        op.execute(statement)


def downgrade() -> None:
    for statement in statements(DOWN):
        op.execute(statement)
