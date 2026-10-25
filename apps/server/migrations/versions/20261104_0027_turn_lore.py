"""每个回合的世界书记录：turns.lore（docs/lorebook.md 第 7.3 节）

- 导演写完这一回合时和回合一起写：这一回合挑中了哪几条（在 playthrough_lore 里的序号），
  以及写完以后哪些条目还在粘滞期、冷却期，各到第几回合为止。下一回合读上一回合（父回合）的这一列。
- 回退以后，下一回合读的是目标回合的记录，粘滞和冷却自然跟着回去；不用在别处记状态。
- 已有的回合都是 '{}'。

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-04

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE turns ADD COLUMN lore JSONB NOT NULL DEFAULT '{}'
"""

DOWN = """
ALTER TABLE turns DROP COLUMN IF EXISTS lore
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
