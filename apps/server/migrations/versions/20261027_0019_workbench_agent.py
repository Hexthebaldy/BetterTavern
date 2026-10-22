"""工作台的 agent 模式（docs/workbench.md 第 3.7、3.8、3.13、4 节）

- workbench_messages：对话记录（话、问卷、回答、方案、确认、改动对比、进度、出错）；
- workbench_events：一边生成一边推送的事件，worker 写、api 读，SSE 断线后从断点接着推；
- workbench_drafts 加 run_id、run_heartbeat_at：正在跑的那一轮和它最近一次报平安的时间，
  agent 的写入都带着 run_id（围栏）；worker 意外退出时，心跳过期的草稿可以重新开一轮；
- model_routes.is_workbench：给工作台单独选的模型，每个用户最多一行；没有时用导演；
- agent_runs.draft_id：工作台 agent（card_maker）的运行记在哪份草稿上。

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-27

迁移里的 DDL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE workbench_messages (
    draft_id    UUID NOT NULL REFERENCES workbench_drafts(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL CHECK (seq >= 1),
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    kind        TEXT NOT NULL
                CHECK (kind IN ('text', 'research', 'questions', 'answers', 'plan', 'plan_reply',
                                'changes', 'images', 'progress', 'error')),
    content     JSONB NOT NULL,
    run_id      UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (draft_id, seq)
);

CREATE TABLE workbench_events (
    id          BIGSERIAL PRIMARY KEY,
    draft_id    UUID NOT NULL REFERENCES workbench_drafts(id) ON DELETE CASCADE,
    run_id      UUID NOT NULL,
    type        TEXT NOT NULL
                CHECK (type IN ('delta', 'field_delta', 'tool', 'message', 'todos', 'draft',
                                'status')),
    data        JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workbench_events_draft_idx ON workbench_events (draft_id, id);
CREATE INDEX workbench_events_created_idx ON workbench_events (created_at);

ALTER TABLE workbench_drafts ADD COLUMN run_id UUID;
ALTER TABLE workbench_drafts ADD COLUMN run_heartbeat_at TIMESTAMPTZ;

ALTER TABLE model_routes ADD COLUMN is_workbench BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX model_routes_workbench_uq ON model_routes (user_id) WHERE is_workbench;

ALTER TABLE agent_runs ADD COLUMN draft_id UUID REFERENCES workbench_drafts(id) ON DELETE CASCADE;
CREATE INDEX agent_runs_draft_idx ON agent_runs (draft_id, created_at)
"""

DOWN = """
DROP INDEX IF EXISTS agent_runs_draft_idx;
ALTER TABLE agent_runs DROP COLUMN draft_id;
DROP INDEX IF EXISTS model_routes_workbench_uq;
ALTER TABLE model_routes DROP COLUMN is_workbench;
ALTER TABLE workbench_drafts DROP COLUMN run_heartbeat_at;
ALTER TABLE workbench_drafts DROP COLUMN run_id;
DROP TABLE IF EXISTS workbench_events;
DROP TABLE IF EXISTS workbench_messages
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
