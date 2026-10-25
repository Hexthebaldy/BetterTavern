"""这一局的世界书快照：playthrough_lore（docs/lorebook.md 第 3.2 节）

- 开局搭世界时把剧本里几张卡自带的世界书和剧本挂的世界书合成一份（宏已经替换好），
  和世界状态在同一个事务里写入；之后改卡、改书都不影响这一局。每回合按关键词从这里挑条目。
- 一局一行；不放进 playthroughs.seed：世界书可能有几十万字，读存档列表时不该带出来。
- 这个迁移之前开局的存档没有这一行，照旧没有世界书（闪电存档的卡快照里还有卡的世界书）。

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-03

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE playthrough_lore (
    playthrough_id  UUID PRIMARY KEY REFERENCES playthroughs(id) ON DELETE CASCADE,
    entries         JSONB NOT NULL DEFAULT '[]',
    meta            JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

DOWN = """
DROP TABLE IF EXISTS playthrough_lore
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
