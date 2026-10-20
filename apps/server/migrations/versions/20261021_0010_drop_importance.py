"""删掉实体和事实的“重要程度”：entities.importance、facts.importance

模型打的分没有客观标准、前后不一致；排序改用能数出来的依据（最近一次出现的回合、建立于第几回合），
见 docs/agent-runtime.md 第 2 节第 12 条。

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-21

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE entities DROP COLUMN importance;
ALTER TABLE facts DROP COLUMN importance
"""

# 降级只把列加回来，原来的分数找不回来，都是默认值 2
DOWN = """
ALTER TABLE entities
    ADD COLUMN importance SMALLINT NOT NULL DEFAULT 2 CHECK (importance BETWEEN 0 AND 5);
ALTER TABLE facts
    ADD COLUMN importance SMALLINT NOT NULL DEFAULT 2 CHECK (importance BETWEEN 0 AND 5)
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
