"""官方模型与点数：运营方的 Key 给用户直接用，按用量扣点数；新用户送体验额度

- model_routes.source：user（用户自己的 Key）/ platform（官方模型，不存 Key，用服务器配置里的）；
  官方模型那一行的 api_key_enc、key_id 为空，每个用户最多一行；
- users.credit_micro：点数余额，单位微元（百万分之一元；1 点 = 1000 微元）；
- credit_ledger：点数账本，只追加不改，每一笔记下之后的余额；同一次 agent 运行只扣一次；
- credit_grants：领过体验额度的邮箱（存 HMAC，不存原文），删号重注册不再送。

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-30

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE model_routes ADD COLUMN source TEXT NOT NULL DEFAULT 'user'
    CHECK (source IN ('user', 'platform'));
ALTER TABLE model_routes ALTER COLUMN api_key_enc DROP NOT NULL;
ALTER TABLE model_routes ALTER COLUMN key_id DROP NOT NULL;
ALTER TABLE model_routes ADD CONSTRAINT model_routes_key_ck
    CHECK (source = 'platform' OR (api_key_enc IS NOT NULL AND key_id IS NOT NULL));
CREATE UNIQUE INDEX model_routes_platform_uq ON model_routes (user_id) WHERE source = 'platform';

ALTER TABLE users ADD COLUMN credit_micro BIGINT NOT NULL DEFAULT 0;

CREATE TABLE credit_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('trial', 'charge', 'adjust')),
    amount_micro    BIGINT NOT NULL,
    balance_micro   BIGINT NOT NULL,
    run_id          UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    agent           TEXT,
    model           TEXT,
    input_tokens    INTEGER CHECK (input_tokens >= 0),
    cached_tokens   INTEGER CHECK (cached_tokens >= 0),
    output_tokens   INTEGER CHECK (output_tokens >= 0),
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger (user_id, created_at);
CREATE UNIQUE INDEX credit_ledger_run_uq ON credit_ledger (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX credit_ledger_charge_idx ON credit_ledger (created_at) WHERE kind = 'charge';

CREATE TABLE credit_grants (
    email_hash      TEXT PRIMARY KEY,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

DOWN = """
DROP TABLE IF EXISTS credit_grants;
DROP TABLE IF EXISTS credit_ledger;
ALTER TABLE users DROP COLUMN IF EXISTS credit_micro;
DELETE FROM model_routes WHERE source = 'platform';
DROP INDEX IF EXISTS model_routes_platform_uq;
ALTER TABLE model_routes DROP CONSTRAINT IF EXISTS model_routes_key_ck;
ALTER TABLE model_routes ALTER COLUMN key_id SET NOT NULL;
ALTER TABLE model_routes ALTER COLUMN api_key_enc SET NOT NULL;
ALTER TABLE model_routes DROP COLUMN IF EXISTS source
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
