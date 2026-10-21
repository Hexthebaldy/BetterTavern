"""召回阶段：导演的隐藏备注、线索表（docs/agent-runtime.md 第 4、7 节）

- turns.director_notes：导演写在选项之后、玩家看不到的备注（埋下的伏笔、答应过的事），
  世界状态 agent 整理这一回合时会读；没写时为空；
- threads：还没解开的悬念、答应过的事、埋下的伏笔。世界状态 agent 用 open_thread / close_thread
  记下和解开，改动和实体、事实一样记进 state_patches（target 是 thread），回退时倒着写回。

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-23

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE turns ADD COLUMN director_notes TEXT;

CREATE TABLE threads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playthrough_id    UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('mystery', 'promise', 'foreshadow')),
    text              TEXT NOT NULL,
    entity_ids        UUID[] NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_seq        INTEGER NOT NULL CHECK (opened_seq >= 0),
    closed_seq        INTEGER,
    source_turn_id    UUID,
    CONSTRAINT threads_closed_ck CHECK ((status = 'closed') = (closed_seq IS NOT NULL))
);
CREATE INDEX threads_pt_open_idx ON threads (playthrough_id, opened_seq) WHERE status = 'open';

ALTER TABLE state_patches DROP CONSTRAINT state_patches_target_check;
ALTER TABLE state_patches ADD CONSTRAINT state_patches_target_check
    CHECK (target IN ('entity', 'link', 'fact', 'thread'))
"""

# 降级时线索的撤销记录没有对应的表，一起删掉
DOWN = """
DELETE FROM state_patches WHERE target = 'thread';
ALTER TABLE state_patches DROP CONSTRAINT state_patches_target_check;
ALTER TABLE state_patches ADD CONSTRAINT state_patches_target_check
    CHECK (target IN ('entity', 'link', 'fact'));
DROP TABLE IF EXISTS threads;
ALTER TABLE turns DROP COLUMN director_notes
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
