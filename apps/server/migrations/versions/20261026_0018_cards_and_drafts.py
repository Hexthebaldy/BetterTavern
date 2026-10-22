"""角色卡仓库、剧本仓库和工作台草稿（docs/workbench.md 第 3 节）

- cards：角色卡仓库。原来 scenarios 里卡片的那几列搬过来，每个现有剧本复制出一张卡，
  卡的 id 沿用剧本的 id；同一个用户导入过两份相同的文件时，只有最早那张卡保留文件指纹
  （给“同一文件只导入一次”的唯一索引让路）；
- card_revisions：角色卡每次正式保存的版本，现有的卡各记一份；
- scenario_cards：剧本用了哪几张卡（群像剧本），有剧本在用的卡不能删；现有剧本各关联自己那张卡；
- scenarios 加 setup（默认主角、偏好、用哪条开场白），删掉搬走的列；
- blobs 加宽高；
- workbench_drafts、workbench_assets：工作台的草稿和草稿里的图片。

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-26

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE cards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    source          TEXT NOT NULL
                    CHECK (source IN ('card_v1', 'card_v2', 'card_v3', 'manual', 'agent')),
    source_sha256   TEXT,
    raw             JSONB,
    card            JSONB NOT NULL,
    cover_blob_id   UUID REFERENCES blobs(id) ON DELETE SET NULL,
    meta            JSONB NOT NULL DEFAULT '{}',
    version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cards (id, user_id, name, source, source_sha256, raw, card, cover_blob_id,
                   version, created_at, updated_at)
    SELECT id, user_id, name, source_kind, source_sha256, raw, card, avatar_blob_id,
           version, created_at, updated_at
    FROM scenarios;
UPDATE cards AS c SET source_sha256 = NULL
    WHERE c.source_sha256 IS NOT NULL AND EXISTS (
        SELECT 1 FROM cards AS d
        WHERE d.user_id = c.user_id AND d.source_sha256 = c.source_sha256
          AND (d.created_at, d.id) < (c.created_at, c.id)
    );
CREATE INDEX cards_user_idx ON cards (user_id, updated_at DESC);
CREATE UNIQUE INDEX cards_user_sha_uq ON cards (user_id, source_sha256)
    WHERE source_sha256 IS NOT NULL;

CREATE TABLE card_revisions (
    card_id         UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL CHECK (version >= 1),
    name            TEXT NOT NULL,
    card            JSONB NOT NULL,
    cover_blob_id   UUID REFERENCES blobs(id) ON DELETE SET NULL,
    draft_id        UUID,
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (card_id, version)
);
INSERT INTO card_revisions (card_id, version, name, card, cover_blob_id, created_at)
    SELECT id, version, name, card, cover_blob_id, updated_at FROM cards;

CREATE TABLE scenario_cards (
    scenario_id     UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    card_id         UUID NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
    position        SMALLINT NOT NULL CHECK (position >= 0 AND position < 8),
    PRIMARY KEY (scenario_id, card_id)
);
CREATE UNIQUE INDEX scenario_cards_position_uq ON scenario_cards (scenario_id, position);
CREATE INDEX scenario_cards_card_idx ON scenario_cards (card_id);
INSERT INTO scenario_cards (scenario_id, card_id, position) SELECT id, id, 0 FROM scenarios;

ALTER TABLE scenarios ADD COLUMN setup JSONB NOT NULL DEFAULT '{}';
ALTER TABLE scenarios DROP COLUMN source_kind;
ALTER TABLE scenarios DROP COLUMN source_sha256;
ALTER TABLE scenarios DROP COLUMN raw;
ALTER TABLE scenarios DROP COLUMN card;
ALTER TABLE scenarios DROP COLUMN avatar_blob_id;
ALTER TABLE scenarios DROP COLUMN edited_at;

ALTER TABLE blobs ADD COLUMN width INTEGER CHECK (width > 0);
ALTER TABLE blobs ADD COLUMN height INTEGER CHECK (height > 0);

CREATE TABLE workbench_drafts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id             UUID REFERENCES cards(id) ON DELETE SET NULL,
    base_version        INTEGER,
    origin              TEXT NOT NULL
                        CHECK (origin IN ('agent', 'manual', 'import_file', 'edit_card')),
    name                TEXT NOT NULL DEFAULT '',
    card                JSONB NOT NULL,
    raw                 JSONB,
    source_sha256       TEXT,
    cover_asset_id      UUID,
    version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    saved_version       INTEGER,
    mode                TEXT NOT NULL DEFAULT 'agent' CHECK (mode IN ('agent', 'manual')),
    stage               TEXT NOT NULL DEFAULT 'start'
                        CHECK (stage IN ('start', 'research', 'questions', 'plan', 'build',
                                         'check', 'done', 'revise')),
    agent_status        TEXT NOT NULL DEFAULT 'idle'
                        CHECK (agent_status IN ('idle', 'running', 'awaiting_user')),
    awaiting            JSONB,
    plan_approved_seq   INTEGER,
    todos               JSONB NOT NULL DEFAULT '[]',
    agent_baseline      JSONB,
    language            TEXT NOT NULL DEFAULT 'zh' CHECK (language IN ('zh', 'en', 'ja')),
    stop_requested      BOOLEAN NOT NULL DEFAULT false,
    last_seq            INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workbench_drafts_user_idx ON workbench_drafts (user_id, updated_at DESC);
CREATE INDEX workbench_drafts_card_idx ON workbench_drafts (card_id);

CREATE TABLE workbench_assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    draft_id        UUID NOT NULL REFERENCES workbench_drafts(id) ON DELETE CASCADE,
    blob_id         UUID NOT NULL REFERENCES blobs(id) ON DELETE CASCADE,
    source          TEXT NOT NULL CHECK (source IN ('search', 'generated', 'upload', 'card')),
    license         TEXT NOT NULL
                    CHECK (license IN ('public_domain', 'copyrighted', 'unknown', 'own')),
    source_url      TEXT,
    prompt          TEXT,
    meta            JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workbench_assets_draft_idx ON workbench_assets (draft_id, created_at);
CREATE INDEX workbench_assets_blob_idx ON workbench_assets (blob_id);

ALTER TABLE workbench_drafts ADD CONSTRAINT workbench_drafts_cover_fk
    FOREIGN KEY (cover_asset_id) REFERENCES workbench_assets(id) ON DELETE SET NULL;
ALTER TABLE card_revisions ADD CONSTRAINT card_revisions_draft_fk
    FOREIGN KEY (draft_id) REFERENCES workbench_drafts(id) ON DELETE SET NULL
"""

# 降级：卡片的列搬回剧本（取每个剧本排第一的那张卡），工作台的表全部删掉
DOWN = """
ALTER TABLE scenarios ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('card_v1', 'card_v2', 'card_v3', 'manual'));
ALTER TABLE scenarios ADD COLUMN source_sha256 TEXT;
ALTER TABLE scenarios ADD COLUMN raw JSONB NOT NULL DEFAULT '{}';
ALTER TABLE scenarios ADD COLUMN card JSONB NOT NULL DEFAULT '{}';
ALTER TABLE scenarios ADD COLUMN avatar_blob_id UUID REFERENCES blobs(id) ON DELETE SET NULL;
ALTER TABLE scenarios ADD COLUMN edited_at TIMESTAMPTZ;
UPDATE scenarios AS s SET
    source_kind = CASE WHEN c.source = 'agent' THEN 'manual' ELSE c.source END,
    source_sha256 = c.source_sha256,
    raw = COALESCE(c.raw, c.card),
    card = c.card,
    avatar_blob_id = c.cover_blob_id
    FROM scenario_cards AS sc JOIN cards AS c ON c.id = sc.card_id
    WHERE sc.scenario_id = s.id AND sc.position = 0;
ALTER TABLE scenarios ALTER COLUMN source_kind DROP DEFAULT;
ALTER TABLE scenarios ALTER COLUMN raw DROP DEFAULT;
ALTER TABLE scenarios ALTER COLUMN card DROP DEFAULT;
ALTER TABLE scenarios DROP COLUMN setup;
DROP TABLE IF EXISTS card_revisions;
DROP TABLE IF EXISTS scenario_cards;
ALTER TABLE workbench_drafts DROP CONSTRAINT IF EXISTS workbench_drafts_cover_fk;
DROP TABLE IF EXISTS workbench_assets;
DROP TABLE IF EXISTS workbench_drafts;
DROP TABLE IF EXISTS cards;
ALTER TABLE blobs DROP COLUMN height;
ALTER TABLE blobs DROP COLUMN width
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
