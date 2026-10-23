"""官方服务的用量：每个用户每天用了几次官方搜索

- platform_usage：(user_id, day, kind) 一行一个计数；day 是 UTC 的日期；kind 目前只有 search；
  每个用户每天、全站每个月的上限在 Quotas 里，用完了工作台 agent 改查维基百科。

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-31

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE platform_usage (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day         DATE NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('search')),
    count       INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id, day, kind)
);
CREATE INDEX platform_usage_day_idx ON platform_usage (kind, day)
"""

DOWN = """
DROP TABLE IF EXISTS platform_usage
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
