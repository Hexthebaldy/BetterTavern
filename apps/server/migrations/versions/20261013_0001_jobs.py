"""任务队列表 jobs

Revision ID: 0001
Revises:
Create Date: 2026-10-13

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE jobs (
    id            BIGSERIAL PRIMARY KEY,
    kind          TEXT NOT NULL,
    ordering_key  TEXT NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'done', 'failed')),
    run_after     TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts      INTEGER NOT NULL DEFAULT 0,
    max_attempts  INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    locked_by     TEXT,
    locked_at     TIMESTAMPTZ,
    last_error    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX jobs_ready_idx ON jobs (run_after, id) WHERE status = 'pending';
CREATE INDEX jobs_open_by_key_idx ON jobs (ordering_key, id) WHERE status IN ('pending', 'running');
CREATE INDEX jobs_running_lock_idx ON jobs (locked_at) WHERE status = 'running';
"""


def statements(ddl: str) -> list[str]:
    """拆成单条语句：asyncpg 走预编译语句，一次只能执行一条。"""
    return [part.strip() for part in ddl.split(";") if part.strip()]


def upgrade() -> None:
    for statement in statements(DDL):
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS jobs")
