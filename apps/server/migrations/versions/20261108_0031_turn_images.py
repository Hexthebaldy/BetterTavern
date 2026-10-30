"""故事里配图：turn_images（F5，docs/illustrations.md）

玩家在阅读页点“画这一幕”时插入一行（pending），后台任务写好画面描述、出图、存好图以后改成 ready，
出错时改成 failed。一回合最多一行 pending；画好一张新的时，同一回合旧的几行一起删掉。

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-08

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE turn_images (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    turn_id        UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'pending' CONSTRAINT turn_images_status_ck
                   CHECK (status IN ('pending', 'ready', 'failed')),
    request        TEXT NOT NULL DEFAULT '',
    style          TEXT NOT NULL DEFAULT '',
    prompt         TEXT,
    blob_id        UUID REFERENCES blobs(id) ON DELETE SET NULL,
    error          TEXT,
    meta           JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX turn_images_turn_idx ON turn_images (turn_id, created_at);
CREATE INDEX turn_images_playthrough_idx ON turn_images (playthrough_id);
CREATE INDEX turn_images_user_pending_idx ON turn_images (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX turn_images_pending_uq ON turn_images (turn_id) WHERE status = 'pending';
CREATE INDEX turn_images_blob_idx ON turn_images (blob_id) WHERE blob_id IS NOT NULL
"""

DOWN = """
DROP TABLE IF EXISTS turn_images
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
