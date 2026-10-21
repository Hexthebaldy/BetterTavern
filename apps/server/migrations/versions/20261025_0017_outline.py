"""大纲（docs/agent-runtime.md 第 4、6 节）

- outline_revisions：大纲修订的每一次决定，只新增不覆盖。changed 为真时 content 是新一版大纲，
  为假时是“不改”（content 为空，reason 写为什么不改）；based_on_seq 是依据到第几回合，
  回退到第 K 回合时 based_on_seq 超过 K 的删掉；
- playthroughs.outline_seq 取代一直是 0 的 outline_version：大纲修订已经看过第几回合之前的
  “要改”的原因（-1 表示还没有大纲），后台写入时先对它做带条件的 UPDATE；
- turn_notes.outline_reason：世界状态 agent 整理这一回合时说“大纲要改”的原因，不用改时为空。

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-25

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE outline_revisions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playthrough_id    UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    based_on_seq      INTEGER NOT NULL CHECK (based_on_seq >= 0),
    changed           BOOLEAN NOT NULL,
    content           JSONB,
    reason            TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT outline_revisions_content_ck CHECK (changed = (content IS NOT NULL))
);
CREATE UNIQUE INDEX outline_revisions_pt_seq_uq
    ON outline_revisions (playthrough_id, based_on_seq);

ALTER TABLE playthroughs
    ADD COLUMN outline_seq INTEGER NOT NULL DEFAULT -1 CHECK (outline_seq >= -1);
ALTER TABLE playthroughs DROP COLUMN outline_version;

ALTER TABLE turn_notes ADD COLUMN outline_reason TEXT NOT NULL DEFAULT ''
"""

# 降级找不回删掉的列原来的值：outline_version 回到 0
DOWN = """
ALTER TABLE turn_notes DROP COLUMN outline_reason;
ALTER TABLE playthroughs ADD COLUMN outline_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playthroughs DROP COLUMN outline_seq;
DROP TABLE IF EXISTS outline_revisions
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
