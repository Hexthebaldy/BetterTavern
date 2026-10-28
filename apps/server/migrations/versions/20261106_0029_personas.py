"""人设库：personas（F3，docs/personas.md）

- 一个人设是玩家扮演的“我”：名字、描述、头像（可以没有）；每个用户最多一个默认人设。
- 剧本的设置里可以选一个人设（scenarios.setup.persona_id），开新故事时先替玩家选好它。
- 已有剧本设置里写了默认主角的，按（用户、名字、描述）去重后变成人设，剧本选上它；
  原来的 setup.protagonist 留着（旧版 App 读写它）。

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-06

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE personas (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    avatar_blob_id UUID REFERENCES blobs(id) ON DELETE SET NULL,
    is_default     BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX personas_user_idx ON personas (user_id, created_at);
CREATE UNIQUE INDEX personas_default_uq ON personas (user_id) WHERE is_default;

INSERT INTO personas (user_id, name, description)
SELECT DISTINCT user_id, setup -> 'protagonist' ->> 'name',
       COALESCE(setup -> 'protagonist' ->> 'summary', '')
FROM scenarios
WHERE COALESCE(setup -> 'protagonist' ->> 'name', '') <> '';

UPDATE scenarios AS s
SET setup = jsonb_set(s.setup, '{persona_id}', to_jsonb(p.id::text))
FROM personas AS p
WHERE p.user_id = s.user_id
  AND p.name = s.setup -> 'protagonist' ->> 'name'
  AND p.description = COALESCE(s.setup -> 'protagonist' ->> 'summary', '')
"""

DOWN = """
UPDATE scenarios SET setup = setup - 'persona_id';
DROP TABLE IF EXISTS personas
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
