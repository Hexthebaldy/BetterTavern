"""角色卡的角色备注：cards.card、card_revisions.card、workbench_drafts.card 补上 depth_prompt

- 角色备注（SillyTavern 的 Character's Note）以前导入时丢掉了，原卡里在
  extensions.depth_prompt.prompt。已经导入的卡从 cards.raw 里读出来补上，规整方式同导入
  （换行统一成 \\n、去掉首尾空白、最多 60000 字，超出的记进 truncated）。
- 卡的旧版本也补上（这个字段以前不能改，取原卡里的就对）；草稿先看自己的 raw（导入了还没保存的），
  没有再看它对应的那张卡的。
- 只补还没有这个键的；原卡里没有角色备注的写成空字符串。不改表结构。

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-05

迁移里的 SQL 是冻结的副本：以后改表结构写新的迁移，不要改这里。
"""

from __future__ import annotations

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

# 原文里的角色备注，规整过（还没截断）；raw 是原卡的 JSON
_NOTE = """regexp_replace(
    replace(COALESCE(COALESCE(raw -> 'data', raw) -> 'extensions'
                     -> 'depth_prompt' ->> 'prompt', ''), E'\\r\\n', E'\\n'),
    '^\\s+|\\s+$', '', 'g')"""
_NOTES = f"WITH notes AS (SELECT id, {_NOTE} AS note FROM cards)"
_DRAFT_NOTES = f"""WITH notes AS (
    SELECT id, {_NOTE} AS note
    FROM (SELECT d.id, COALESCE(d.raw, c.raw) AS raw
          FROM workbench_drafts d LEFT JOIN cards c ON c.id = d.card_id) AS drafts
)"""

# 写进 card 列：超过 60000 字的截断，并记进 truncated
_FILL = """
SET card = jsonb_set(
    CASE WHEN length(n.note) > 60000
         THEN jsonb_set(t.card, '{truncated}',
                        COALESCE(t.card -> 'truncated', '[]'::jsonb) || '["depth_prompt"]'::jsonb)
         ELSE t.card END,
    '{depth_prompt}', to_jsonb(left(n.note, 60000)))
"""

DDL = f"""
{_NOTES}
UPDATE cards t {_FILL}
FROM notes n WHERE n.id = t.id AND NOT (t.card ? 'depth_prompt');

{_NOTES}
UPDATE card_revisions t {_FILL}
FROM notes n WHERE n.id = t.card_id AND NOT (t.card ? 'depth_prompt');

{_DRAFT_NOTES}
UPDATE workbench_drafts t {_FILL}
FROM notes n WHERE n.id = t.id AND NOT (t.card ? 'depth_prompt')
"""

DOWN = """
UPDATE cards SET card = card - 'depth_prompt';
UPDATE card_revisions SET card = card - 'depth_prompt';
UPDATE workbench_drafts SET card = card - 'depth_prompt'
"""


def statements(ddl: str) -> list[str]:
    """拆成单条语句：asyncpg 走预编译语句，一次只能执行一条。SQL 里不出现字符串内的分号。"""
    return [part.strip() for part in ddl.split(";") if part.strip()]


def upgrade() -> None:
    for statement in statements(DDL):
        op.execute(statement)


def downgrade() -> None:
    for statement in statements(DOWN):
        op.execute(statement)
