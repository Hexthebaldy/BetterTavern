"""分层记忆：章节摘要、全书梗概、玩家画像（docs/agent-runtime.md 第 4、6、7 节）

- story_summaries：章节摘要（chapter）和全书梗概（synopsis，每次改写新增一版），记下覆盖的回合和
  写它时章节摘要覆盖到第几回合（written_seq），只新增不覆盖；回退到第 K 回合时 written_seq 超过 K 的
  删掉：一版梗概覆盖的虽然是更早的回合，但它是在 K 之后写某一章时并出来的，只玩到 K 时还没有它；
- player_profiles：玩家画像，每章结束时改写一版，用最新的一版；回退时不动；
- playthroughs.summarized_seq：章节摘要已经覆盖到第几回合（-1 表示还没有），后台写章节摘要时
  先对它做带条件的 UPDATE；
- 删掉一直是 0 的 playthroughs.summary_version 和 rollback_floor_seq（回退没有下限）。

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-24

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE story_summaries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playthrough_id    UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('chapter', 'synopsis')),
    first_seq         INTEGER NOT NULL CHECK (first_seq >= 0),
    last_seq          INTEGER NOT NULL,
    written_seq       INTEGER NOT NULL,
    text              TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT story_summaries_range_ck CHECK (last_seq >= first_seq AND written_seq >= last_seq)
);
CREATE UNIQUE INDEX story_summaries_pt_kind_last_uq
    ON story_summaries (playthrough_id, kind, last_seq);

CREATE TABLE player_profiles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playthrough_id    UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    text              TEXT NOT NULL,
    based_on_seq      INTEGER NOT NULL CHECK (based_on_seq >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX player_profiles_pt_idx ON player_profiles (playthrough_id, created_at);

ALTER TABLE playthroughs
    ADD COLUMN summarized_seq INTEGER NOT NULL DEFAULT -1 CHECK (summarized_seq >= -1);
ALTER TABLE playthroughs DROP COLUMN summary_version;
ALTER TABLE playthroughs DROP COLUMN rollback_floor_seq
"""

# 降级找不回删掉的列原来的值：两列都回到 0
DOWN = """
ALTER TABLE playthroughs ADD COLUMN rollback_floor_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playthroughs ADD COLUMN summary_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playthroughs DROP COLUMN summarized_seq;
DROP TABLE IF EXISTS player_profiles;
DROP TABLE IF EXISTS story_summaries
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
