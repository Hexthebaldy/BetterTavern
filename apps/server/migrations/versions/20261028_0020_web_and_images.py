"""工作台的联网和文生图（docs/workbench.md 第 3.10–3.12、5、6 节）

- tool_routes：外部服务的配置（搜索、读网页、文生图），Key 和模型路由一样加密，id 由应用生成；
- web_pages：读过的网页全文，按用户分开存；既是缓存，也给“按行读中间那段”用；
- workbench_notes：agent 查资料记下的笔记，带出处和用在卡片哪里。

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-28

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE tool_routes (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('search', 'fetch', 'image')),
    provider        TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    base_url        TEXT,
    api_key_enc     TEXT,
    key_id          TEXT,
    key_last4       TEXT NOT NULL DEFAULT '',
    model           TEXT,
    params          JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'unverified'
                    CHECK (status IN ('unverified', 'ok', 'invalid')),
    probe           JSONB NOT NULL DEFAULT '{}',
    is_default      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tool_routes_user_idx ON tool_routes (user_id, kind, created_at);
CREATE UNIQUE INDEX tool_routes_default_uq ON tool_routes (user_id, kind) WHERE is_default;

CREATE TABLE web_pages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    url_hash        TEXT NOT NULL,
    final_url       TEXT,
    title           TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL,
    fetcher         TEXT NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX web_pages_lookup_idx ON web_pages (user_id, url_hash, fetched_at DESC);
CREATE INDEX web_pages_fetched_idx ON web_pages (fetched_at);

CREATE TABLE workbench_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id        UUID NOT NULL REFERENCES workbench_drafts(id) ON DELETE CASCADE,
    text            TEXT NOT NULL CHECK (char_length(text) <= 2000),
    source          JSONB NOT NULL DEFAULT '{}',
    used_in         JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workbench_notes_draft_idx ON workbench_notes (draft_id, created_at)
"""

DOWN = """
DROP TABLE IF EXISTS workbench_notes;
DROP TABLE IF EXISTS web_pages;
DROP TABLE IF EXISTS tool_routes
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
