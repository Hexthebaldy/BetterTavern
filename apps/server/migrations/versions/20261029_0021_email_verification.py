"""邮箱验证码：注册时验证邮箱、找回密码

- users.email_verified_at：邮箱验证通过的时间。现有账号都算已验证（取注册时间）；
  不要求验证邮箱的部署（没配发信服务）注册时直接写入；
- email_codes：发出去的验证码，每个账号每种用途只留最新的一个，只存 HMAC；
  错 5 次、过期或用过就删掉。

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-29

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = created_at;
CREATE INDEX users_unverified_idx ON users (created_at) WHERE email_verified_at IS NULL;

CREATE TABLE email_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose         TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    code_hash       TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_codes_user_purpose_uq ON email_codes (user_id, purpose);
CREATE INDEX email_codes_expires_idx ON email_codes (expires_at)
"""

DOWN = """
DROP TABLE IF EXISTS email_codes;
DROP INDEX IF EXISTS users_unverified_idx;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at
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
