"""闪电模式：playthroughs.mode

- playthroughs.mode：standard / lightning，开局时从剧本的设置（scenarios.setup.lightning）拷过来，
  之后不变；已有的存档都是 standard。闪电模式只有导演，不整理世界状态、不写大纲
  （docs/agent-runtime.md 的“闪电模式”）。

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-01

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE playthroughs
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'standard'
        CONSTRAINT playthroughs_mode_ck CHECK (mode IN ('standard', 'lightning'))
"""

DOWN = """
ALTER TABLE playthroughs DROP COLUMN IF EXISTS mode
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
