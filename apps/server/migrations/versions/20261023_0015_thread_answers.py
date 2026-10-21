"""线索带上导演定下的答案，几条说同一件事的线索可以合成一条（docs/agent-runtime.md 第 7 节）

- threads.answer：导演定下的答案（来自隐藏备注），只给导演看；原文移出上下文以后答案还在；
- threads.status 加一个 merged：被合进另一条线索，merged_into 指向合成的那一条；
  closed_seq 也记下合并的回合。

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-23

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE threads ADD COLUMN answer TEXT NOT NULL DEFAULT '';
ALTER TABLE threads ADD COLUMN merged_into UUID;
ALTER TABLE threads DROP CONSTRAINT threads_status_check;
ALTER TABLE threads ADD CONSTRAINT threads_status_check
    CHECK (status IN ('open', 'closed', 'merged'));
ALTER TABLE threads DROP CONSTRAINT threads_closed_ck;
ALTER TABLE threads ADD CONSTRAINT threads_closed_ck
    CHECK ((status = 'open') = (closed_seq IS NULL));
ALTER TABLE threads ADD CONSTRAINT threads_merged_ck
    CHECK ((status = 'merged') = (merged_into IS NOT NULL))
"""

# 降级时合并掉的线索记成已解开
DOWN = """
ALTER TABLE threads DROP CONSTRAINT threads_merged_ck;
UPDATE threads SET status = 'closed' WHERE status = 'merged';
ALTER TABLE threads DROP CONSTRAINT threads_closed_ck;
ALTER TABLE threads ADD CONSTRAINT threads_closed_ck
    CHECK ((status = 'closed') = (closed_seq IS NOT NULL));
ALTER TABLE threads DROP CONSTRAINT threads_status_check;
ALTER TABLE threads ADD CONSTRAINT threads_status_check CHECK (status IN ('open', 'closed'));
ALTER TABLE threads DROP COLUMN merged_into;
ALTER TABLE threads DROP COLUMN answer
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
