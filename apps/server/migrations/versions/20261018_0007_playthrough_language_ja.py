"""游玩的提示词语言加上日文：允许 zh、en、ja（docs/i18n.md 第 4 节）

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-18

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE playthroughs DROP CONSTRAINT playthroughs_language_check;
ALTER TABLE playthroughs ADD CONSTRAINT playthroughs_language_check
    CHECK (language IN ('zh', 'en', 'ja'))
"""

# 降级前把日文的局改回默认的 zh，否则旧约束加不上
DOWN = """
UPDATE playthroughs SET language = 'zh' WHERE language = 'ja';
ALTER TABLE playthroughs DROP CONSTRAINT playthroughs_language_check;
ALTER TABLE playthroughs ADD CONSTRAINT playthroughs_language_check
    CHECK (language IN ('zh', 'en'))
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
