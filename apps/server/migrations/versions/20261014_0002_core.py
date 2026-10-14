"""M1 核心表：账户、凭据、模型路由、剧本、游玩、回合、世界状态、账本、幂等键

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-14

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
state_patches、outline_revisions、summaries 随 M2、M3 的迁移加入。
"""

from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL,
    email_norm     TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    display_name   TEXT NOT NULL DEFAULT '',
    locale         TEXT NOT NULL DEFAULT 'zh',
    settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id    UUID NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at      TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    user_agent   TEXT
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE credentials (
    id                 UUID PRIMARY KEY,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    label              TEXT NOT NULL,
    base_url           TEXT,
    api_key_enc        TEXT NOT NULL,
    key_id             TEXT NOT NULL,
    key_last4          TEXT NOT NULL DEFAULT '',
    extra_headers_enc  TEXT,
    extra_body         JSONB NOT NULL DEFAULT '{}'::jsonb,
    probed             JSONB NOT NULL DEFAULT '{}'::jsonb,
    status             TEXT NOT NULL DEFAULT 'unverified'
                       CHECK (status IN ('unverified', 'ok', 'invalid')),
    last_ok_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credentials_user_idx ON credentials (user_id, created_at);

CREATE TABLE blobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sha256      TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL CHECK (size >= 0),
    data        BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blobs_user_sha_idx ON blobs (user_id, sha256);

CREATE TABLE scenarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    source_kind     TEXT NOT NULL CHECK (source_kind IN ('card_v1', 'card_v2', 'card_v3', 'manual')),
    source_sha256   TEXT,
    raw             JSONB NOT NULL,
    card            JSONB NOT NULL,
    avatar_blob_id  UUID REFERENCES blobs(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scenarios_user_idx ON scenarios (user_id, created_at DESC);

CREATE TABLE playthroughs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scenario_id         UUID REFERENCES scenarios(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'active')),
    language            TEXT NOT NULL DEFAULT 'zh',
    settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
    seed                JSONB,
    seed_source         TEXT CHECK (seed_source IN ('world_builder', 'minimal')),
    head_turn_id        UUID,
    timeline_epoch      INTEGER NOT NULL DEFAULT 0,
    state_version       INTEGER NOT NULL DEFAULT 0,
    outline_version     INTEGER NOT NULL DEFAULT 0,
    summary_version     INTEGER NOT NULL DEFAULT 0,
    rollback_floor_seq  INTEGER NOT NULL DEFAULT 0,
    active_turn_id      UUID,
    lease_expires_at    TIMESTAMPTZ,
    lease_owner         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX playthroughs_user_idx ON playthroughs (user_id, updated_at DESC);
CREATE INDEX playthroughs_lease_idx ON playthroughs (lease_expires_at)
    WHERE active_turn_id IS NOT NULL;

CREATE TABLE turns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playthrough_id   UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    seq              INTEGER NOT NULL CHECK (seq >= 0),
    parent_turn_id   UUID,
    attempt          INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL
                     CHECK (status IN ('generating', 'replied', 'committed', 'failed', 'archived')),
    timeline_epoch   INTEGER NOT NULL DEFAULT 0,
    user_action      JSONB NOT NULL,
    narrative        TEXT NOT NULL DEFAULT '',
    options          JSONB NOT NULL DEFAULT '[]'::jsonb,
    options_source   TEXT CHECK (options_source IN ('model', 'repaired', 'fallback')),
    director_run_id  UUID,
    state_lag        BOOLEAN NOT NULL DEFAULT false,
    usage            JSONB,
    error            JSONB,
    rollback_id      UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    replied_at       TIMESTAMPTZ,
    committed_at     TIMESTAMPTZ
);
-- 活跃链上每个 seq 只有一个回合；失败的尝试和被回退的回合不占位
CREATE UNIQUE INDEX turns_chain_seq_uq ON turns (playthrough_id, seq)
    WHERE status NOT IN ('failed', 'archived');
CREATE INDEX turns_pt_seq_idx ON turns (playthrough_id, seq, created_at);

CREATE TABLE model_routes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playthrough_id     UUID REFERENCES playthroughs(id) ON DELETE CASCADE,
    task               TEXT NOT NULL CHECK (task IN ('director', 'state_keeper', 'outline',
                                                     'compactor', 'gate', 'world_builder',
                                                     'repair')),
    credential_id      UUID NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    model              TEXT NOT NULL,
    params             JSONB NOT NULL DEFAULT '{}'::jsonb,
    caps_override      JSONB NOT NULL DEFAULT '{}'::jsonb,
    fallback_route_id  UUID REFERENCES model_routes(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX model_routes_user_task_uq ON model_routes (user_id, task)
    WHERE playthrough_id IS NULL;
CREATE UNIQUE INDEX model_routes_pt_task_uq ON model_routes (playthrough_id, task)
    WHERE playthrough_id IS NOT NULL;

CREATE TABLE entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playthrough_id  UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL
                    CHECK (kind IN ('character', 'item', 'location', 'organization', 'world')),
    name            TEXT NOT NULL,
    name_norm       TEXT NOT NULL,
    aliases         TEXT[] NOT NULL DEFAULT '{}',
    summary         TEXT NOT NULL DEFAULT '',
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    importance      SMALLINT NOT NULL DEFAULT 2 CHECK (importance BETWEEN 0 AND 5),
    canon           TEXT NOT NULL DEFAULT 'canon' CHECK (canon IN ('sketch', 'canon')),
    is_protagonist  BOOLEAN NOT NULL DEFAULT false,
    first_seq       INTEGER NOT NULL DEFAULT 0,
    last_seen_seq   INTEGER NOT NULL DEFAULT 0,
    rev             INTEGER NOT NULL DEFAULT 1,
    retired         BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX entities_name_uq ON entities (playthrough_id, kind, name_norm)
    WHERE NOT retired;
CREATE UNIQUE INDEX entities_protagonist_uq ON entities (playthrough_id)
    WHERE is_protagonist AND NOT retired;
CREATE INDEX entities_aliases_gin ON entities USING GIN (aliases);

CREATE TABLE entity_links (
    playthrough_id  UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    src_id          UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    rel             TEXT NOT NULL,
    dst_id          UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    since_seq       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (src_id, rel, dst_id)
);
CREATE INDEX entity_links_dst_idx ON entity_links (dst_id, rel);
CREATE INDEX entity_links_pt_idx ON entity_links (playthrough_id);

CREATE TABLE facts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playthrough_id  UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    entity_ids      UUID[] NOT NULL DEFAULT '{}',
    importance      SMALLINT NOT NULL DEFAULT 2 CHECK (importance BETWEEN 0 AND 5),
    visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'secret')),
    known_by        UUID[] NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
    superseded_by   UUID,
    created_seq     INTEGER NOT NULL DEFAULT 0,
    source_turn_id  UUID
);
CREATE INDEX facts_pt_active_idx ON facts (playthrough_id) WHERE status = 'active';
CREATE INDEX facts_entities_gin ON facts USING GIN (entity_ids);

CREATE TABLE agent_runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playthrough_id    UUID REFERENCES playthroughs(id) ON DELETE CASCADE,
    turn_id           UUID,
    agent             TEXT NOT NULL,
    task              TEXT NOT NULL,
    provider          TEXT,
    model             TEXT,
    prompt_hash       TEXT,
    input_tokens      INTEGER,
    cached_tokens     INTEGER,
    output_tokens     INTEGER,
    reasoning_tokens  INTEGER,
    ttft_ms           INTEGER,
    latency_ms        INTEGER,
    status            TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'stale', 'cancelled')),
    error_class       TEXT,
    result            JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_turn_idx ON agent_runs (turn_id, agent);
CREATE INDEX agent_runs_pt_idx ON agent_runs (playthrough_id, created_at);

CREATE TABLE idempotency_keys (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key           TEXT NOT NULL,
    request_hash  TEXT NOT NULL,
    turn_id       UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
"""

DROP = """
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS facts;
DROP TABLE IF EXISTS entity_links;
DROP TABLE IF EXISTS entities;
DROP TABLE IF EXISTS model_routes;
DROP TABLE IF EXISTS turns;
DROP TABLE IF EXISTS playthroughs;
DROP TABLE IF EXISTS scenarios;
DROP TABLE IF EXISTS blobs;
DROP TABLE IF EXISTS credentials;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
"""


def statements(ddl: str) -> list[str]:
    """拆成单条语句：asyncpg 走预编译语句，一次只能执行一条。DDL 里不出现字符串内的分号。"""
    return [part.strip() for part in ddl.split(";") if part.strip()]


def upgrade() -> None:
    for statement in statements(DDL):
        op.execute(statement)


def downgrade() -> None:
    for statement in statements(DROP):
        op.execute(statement)
