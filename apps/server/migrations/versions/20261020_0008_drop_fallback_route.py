"""模型去掉“备用模型”：删除 model_routes.fallback_route_id

调导演出错时不再换别的模型重发，这一轮直接失败，由玩家决定重试还是换模型，所以这一栏不再有用。

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-20

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

DDL = """
ALTER TABLE model_routes DROP COLUMN fallback_route_id
"""

# 降级只把这一栏加回来，原来填的备用模型找不回来，都是空
DOWN = """
ALTER TABLE model_routes
    ADD COLUMN fallback_route_id UUID REFERENCES model_routes(id) ON DELETE SET NULL
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
