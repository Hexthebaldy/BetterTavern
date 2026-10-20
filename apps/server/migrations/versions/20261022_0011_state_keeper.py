"""世界状态 agent：后台模型、整理进度、撤销记录、回合标签（docs/agent-runtime.md 第 4、8 节）

- model_routes.is_background：用于后台整理的模型，每个用户最多一行为真；
- playthroughs.state_seq 取代 state_version：世界状态已整理到第几回合，-1 表示还没整理过任何回合。
  已有的存档按“已经整理到最新一回合”处理，不回头整理旧回合；
- turns.state_seq 取代 state_lag：这一回合的状态块截至第几回合；
- facts.superseded_seq：事实从第几回合起不再成立；
- state_patches：世界状态 agent 每改一行，记下这一行改之前和改之后的样子，回退时倒着写回；
- turn_notes：每回合的一句话摘要、涉及的实体、场景是否结束、是否被跳过。

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-22

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE model_routes ADD COLUMN is_background BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX model_routes_background_uq ON model_routes (user_id) WHERE is_background;

ALTER TABLE playthroughs
    ADD COLUMN state_seq INTEGER NOT NULL DEFAULT -1 CHECK (state_seq >= -1);
UPDATE playthroughs AS p SET state_seq = COALESCE(
    (SELECT max(t.seq) FROM turns AS t
     WHERE t.playthrough_id = p.id AND t.status IN ('replied', 'committed')),
    -1
);
ALTER TABLE playthroughs DROP COLUMN state_version;

ALTER TABLE turns ADD COLUMN state_seq INTEGER NOT NULL DEFAULT -1 CHECK (state_seq >= -1);
ALTER TABLE turns DROP COLUMN state_lag;
UPDATE turns SET status = 'committed', committed_at = COALESCE(committed_at, replied_at)
WHERE status = 'replied';

ALTER TABLE facts ADD COLUMN superseded_seq INTEGER;

CREATE TABLE state_patches (
    turn_id           UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    idx               SMALLINT NOT NULL CHECK (idx >= 0),
    playthrough_id    UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    seq               INTEGER NOT NULL CHECK (seq >= 0),
    target            TEXT NOT NULL CHECK (target IN ('entity', 'link', 'fact')),
    before            JSONB,
    after             JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (turn_id, idx),
    CONSTRAINT state_patches_change_ck CHECK (before IS NOT NULL OR after IS NOT NULL)
);
CREATE INDEX state_patches_pt_seq_idx ON state_patches (playthrough_id, seq);

CREATE TABLE turn_notes (
    turn_id           UUID PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    playthrough_id    UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    seq               INTEGER NOT NULL CHECK (seq >= 0),
    digest            TEXT NOT NULL DEFAULT '',
    entity_ids        UUID[] NOT NULL DEFAULT '{}',
    scene_ended       BOOLEAN NOT NULL DEFAULT false,
    skipped           BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX turn_notes_pt_seq_uq ON turn_notes (playthrough_id, seq);
CREATE INDEX turn_notes_entities_gin ON turn_notes USING gin (entity_ids)
"""

# 降级找不回删掉的列原来的值：state_version 回到 0，state_lag 回到 false
DOWN = """
DROP TABLE IF EXISTS turn_notes;
DROP TABLE IF EXISTS state_patches;
ALTER TABLE facts DROP COLUMN superseded_seq;
ALTER TABLE turns ADD COLUMN state_lag BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE turns DROP COLUMN state_seq;
ALTER TABLE playthroughs ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playthroughs DROP COLUMN state_seq;
DROP INDEX IF EXISTS model_routes_background_uq;
ALTER TABLE model_routes DROP COLUMN is_background
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
