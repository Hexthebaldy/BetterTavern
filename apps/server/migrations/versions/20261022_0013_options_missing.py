"""回合的选项来源加一个 missing：补选项两次都没补齐，选项不足 2 个，玩家自己写下一步

不再用固定的默认选项，所以以后不会再写 fallback；早先用过默认选项的回合仍然是 fallback。

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-22

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE turns DROP CONSTRAINT turns_options_source_check;
ALTER TABLE turns ADD CONSTRAINT turns_options_source_check
    CHECK (options_source IN ('model', 'repaired', 'fallback', 'missing'))
"""

# 降级时 missing 没有对应的值，记成 fallback
DOWN = """
UPDATE turns SET options_source = 'fallback' WHERE options_source = 'missing';
ALTER TABLE turns DROP CONSTRAINT turns_options_source_check;
ALTER TABLE turns ADD CONSTRAINT turns_options_source_check
    CHECK (options_source IN ('model', 'repaired', 'fallback'))
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
