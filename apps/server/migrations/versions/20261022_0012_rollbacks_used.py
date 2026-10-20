"""回退次数：playthroughs.rollbacks_used（docs/agent-runtime.md 第 8 节“回退到第 K 回合”）

每个存档能回退的次数有上限（服务端设置，先是 1 次）；这一列记已经回退了几次。

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-22

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE playthroughs
    ADD COLUMN rollbacks_used INTEGER NOT NULL DEFAULT 0 CHECK (rollbacks_used >= 0)
"""

DOWN = """
ALTER TABLE playthroughs DROP COLUMN rollbacks_used
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
