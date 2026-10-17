"""游玩加一个状态 ended：玩家选了“写结局”，结局写完后这局就结束了

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-16

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE playthroughs DROP CONSTRAINT playthroughs_status_check;
ALTER TABLE playthroughs ADD CONSTRAINT playthroughs_status_check
    CHECK (status IN ('building', 'active', 'ended'))
"""

# 回到 0003：已完结的故事改回进行中（之后又能继续写）
DOWN = """
UPDATE playthroughs SET status = 'active' WHERE status = 'ended';
ALTER TABLE playthroughs DROP CONSTRAINT playthroughs_status_check;
ALTER TABLE playthroughs ADD CONSTRAINT playthroughs_status_check
    CHECK (status IN ('building', 'active'))
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
