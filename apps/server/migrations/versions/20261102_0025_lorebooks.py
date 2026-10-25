"""世界书仓库：lorebooks、scenario_lorebooks（docs/lorebook.md）

- lorebooks：独立的世界书，导入的（SillyTavern 的世界书文件、角色卡格式的世界书）或新建的；
  条目在 book 里，结构同卡里的世界书；同一个用户同一个文件只记一本（source_sha256）。
- scenario_lorebooks：剧本挂了哪几本（最多 4 本）。删书时级联删掉，书从剧本上摘掉，剧本照样能玩。

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-02

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE lorebooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL CHECK (source IN ('st_world', 'lorebook', 'manual')),
    source_sha256   TEXT,
    raw             JSONB,
    book            JSONB NOT NULL DEFAULT '[]',
    report          JSONB NOT NULL DEFAULT '{}',
    version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lorebooks_user_idx ON lorebooks (user_id, updated_at DESC);
CREATE UNIQUE INDEX lorebooks_user_sha_uq ON lorebooks (user_id, source_sha256)
    WHERE source_sha256 IS NOT NULL;

CREATE TABLE scenario_lorebooks (
    scenario_id     UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    lorebook_id     UUID NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
    position        SMALLINT NOT NULL CHECK (position >= 0 AND position < 4),
    PRIMARY KEY (scenario_id, lorebook_id)
);
CREATE UNIQUE INDEX scenario_lorebooks_position_uq ON scenario_lorebooks (scenario_id, position);
CREATE INDEX scenario_lorebooks_lorebook_idx ON scenario_lorebooks (lorebook_id)
"""

DOWN = """
DROP TABLE IF EXISTS scenario_lorebooks;
DROP TABLE IF EXISTS lorebooks
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
