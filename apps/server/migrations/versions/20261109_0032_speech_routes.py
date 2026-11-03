"""外部服务加一种：朗读（F6，docs/speech.md）

tool_routes.kind 多一个 speech。声音不存，所以没有新表。

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-09

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE tool_routes DROP CONSTRAINT tool_routes_kind_check;
ALTER TABLE tool_routes ADD CONSTRAINT tool_routes_kind_check
    CHECK (kind IN ('search', 'fetch', 'image', 'speech'))
"""

DOWN = """
DELETE FROM tool_routes WHERE kind = 'speech';
ALTER TABLE tool_routes DROP CONSTRAINT tool_routes_kind_check;
ALTER TABLE tool_routes ADD CONSTRAINT tool_routes_kind_check
    CHECK (kind IN ('search', 'fetch', 'image'))
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
