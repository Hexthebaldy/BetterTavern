"""游玩的提示词语言只允许 zh、en：开局时由客户端按界面语言传来（docs/i18n.md 第 4 节）

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-17

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

# 之前一直写 zh；万一有别的值，按默认的 zh 处理
DDL = """
UPDATE playthroughs SET language = 'zh' WHERE language NOT IN ('zh', 'en');
ALTER TABLE playthroughs ADD CONSTRAINT playthroughs_language_check
    CHECK (language IN ('zh', 'en'))
"""

DOWN = """
ALTER TABLE playthroughs DROP CONSTRAINT playthroughs_language_check
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
