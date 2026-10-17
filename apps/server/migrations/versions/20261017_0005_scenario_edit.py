"""剧本可以编辑：加版本号（防止两台设备互相覆盖）和最近一次编辑卡片的时间

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-17

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE scenarios ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE scenarios ADD COLUMN edited_at TIMESTAMPTZ
"""

DOWN = """
ALTER TABLE scenarios DROP COLUMN edited_at;
ALTER TABLE scenarios DROP COLUMN version
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
