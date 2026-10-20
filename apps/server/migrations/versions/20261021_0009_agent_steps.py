"""agent 运行的每一步：agent_steps（docs/agent-runtime.md 第 5 节“记录与重放”）

一次 agent 运行（agent_runs 的一行）里每调一次模型、每用一次工具记一行，用于查问题和重放。
参数和结果里有故事文字，所以只存在这里，不写日志。

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-21

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE agent_steps (
    run_id            UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step              SMALLINT NOT NULL CHECK (step >= 0),
    kind              TEXT NOT NULL CHECK (kind IN ('model', 'tool')),
    tool              TEXT,
    args              JSONB NOT NULL DEFAULT '{}'::jsonb,
    result            JSONB NOT NULL DEFAULT '{}'::jsonb,
    latency_ms        INTEGER,
    input_tokens      INTEGER,
    cached_tokens     INTEGER,
    output_tokens     INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, step)
)
"""

DOWN = """
DROP TABLE IF EXISTS agent_steps
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
