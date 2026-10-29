"""多角色：playthrough_cast、turns.segments（F4，docs/cast.md）

- playthrough_cast：多角色的局（剧本里有两张以上的卡）开局搭世界时写入，一张卡一行：名字、封面、
  玩家有没有让他先不出场。位置就是卡在剧本里的顺序。
- turns.segments：多角色的局每一段是谁写的、写了什么；只有导演一个人写的回合是空数组。
- 已经开了的局不补：它们照旧由导演一个人写。

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-07

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE playthrough_cast (
    playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL CHECK (position >= 0),
    name           TEXT NOT NULL,
    cover_blob_id  UUID REFERENCES blobs(id) ON DELETE SET NULL,
    muted          BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (playthrough_id, position)
);
CREATE INDEX playthrough_cast_cover_idx ON playthrough_cast (cover_blob_id)
    WHERE cover_blob_id IS NOT NULL;
ALTER TABLE turns ADD COLUMN segments JSONB NOT NULL DEFAULT '[]'
"""

DOWN = """
ALTER TABLE turns DROP COLUMN IF EXISTS segments;
DROP TABLE IF EXISTS playthrough_cast
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
