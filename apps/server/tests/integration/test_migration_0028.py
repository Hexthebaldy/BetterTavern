"""迁移 0028：已经导入的卡从原卡里补上角色备注（depth_prompt），卡的旧版本和草稿也补；能降级回去。

在只执行到 0027 的临时 schema 里写入还没有这个键的数据，再执行 0028 检查补上的样子。
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from bettertavern.infra.db.engine import normalize_url
from tests.support.pg import database_url, engine_for, migrations

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


def v2(note: Any) -> dict[str, Any]:
    return {"spec": "chara_card_v2", "data": {"name": "阿苓", "extensions": {"depth_prompt": note}}}


async def insert(conn: AsyncConnection, sql: str, **values: Any) -> str:
    return str((await conn.execute(text(sql), values)).scalar_one())


async def card_of(conn: AsyncConnection, table: str, id_: str) -> dict[str, Any]:
    key = "card_id" if table == "card_revisions" else "id"  # 卡的版本按卡的 id 找
    row = await conn.execute(text(f"SELECT card FROM {table} WHERE {key} = :id"), {"id": id_})
    return dict(row.scalar_one())


async def test_old_cards_get_their_depth_prompt_and_back() -> None:
    url = database_url()
    assert url is not None
    schema = f"test_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(normalize_url(url))
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = engine_for(url, schema, pool_size=1)
    modules = migrations()
    m0028 = next(m for m in modules if m.revision == "0028")
    try:
        async with engine.begin() as conn:
            for module in (m for m in modules if m.revision < "0028"):
                for statement in module.statements(module.DDL):
                    await conn.execute(text(statement))
            user = await insert(
                conn,
                """INSERT INTO users (email, email_norm, password_hash)
                   VALUES ('a@x.cn', 'a@x.cn', 'h') RETURNING id""",
            )
            card = {"spec": "card_v2", "name": "阿苓", "truncated": ["description"]}
            cards: dict[str, str] = {}
            raws = {
                "note": v2({"prompt": "  {{char}} 嘴硬。\r\n第二行  ", "depth": 4}),
                "long": v2({"prompt": "x" * 70_000}),
                "v1": {"name": "老周", "description": "掌柜"},
                "odd": v2("不是对象"),
                "manual": None,
            }
            for key, raw in raws.items():
                cards[key] = await insert(
                    conn,
                    """INSERT INTO cards (user_id, name, source, raw, card)
                       VALUES (:u, :n, 'card_v2', CAST(:raw AS jsonb), CAST(:card AS jsonb))
                       RETURNING id""",
                    u=user,
                    n=key,
                    raw=None if raw is None else json.dumps(raw),
                    card=json.dumps(card),
                )
            revision = await insert(
                conn,
                """INSERT INTO card_revisions (card_id, version, name, card)
                   VALUES (:c, 1, '阿苓', CAST(:card AS jsonb)) RETURNING card_id""",
                c=cards["note"],
                card=json.dumps(card),
            )
            drafts = {
                "opened": await insert(
                    conn,
                    """INSERT INTO workbench_drafts (user_id, card_id, origin, card)
                       VALUES (:u, :c, 'edit_card', CAST(:card AS jsonb)) RETURNING id""",
                    u=user,
                    c=cards["note"],
                    card=json.dumps(card),
                ),
                "imported": await insert(
                    conn,
                    """INSERT INTO workbench_drafts (user_id, origin, card, raw)
                       VALUES (:u, 'import_file', CAST(:card AS jsonb), CAST(:raw AS jsonb))
                       RETURNING id""",
                    u=user,
                    card=json.dumps(card),
                    raw=json.dumps(v2({"prompt": "草稿里的"})),
                ),
            }
            # 已经有这个键的（迁移以后新导入的）不动
            done = {**card, "depth_prompt": "新导入的"}
            cards["done"] = await insert(
                conn,
                """INSERT INTO cards (user_id, name, source, raw, card)
                   VALUES (:u, 'done', 'card_v2', CAST(:raw AS jsonb), CAST(:card AS jsonb))
                   RETURNING id""",
                u=user,
                raw=json.dumps(v2({"prompt": "原卡里的"})),
                card=json.dumps(done),
            )

            for statement in m0028.statements(m0028.DDL):
                await conn.execute(text(statement))

            note = await card_of(conn, "cards", cards["note"])
            assert note["depth_prompt"] == "{{char}} 嘴硬。\n第二行"
            assert note["truncated"] == ["description"]
            long = await card_of(conn, "cards", cards["long"])
            assert len(long["depth_prompt"]) == 60_000
            assert long["truncated"] == ["description", "depth_prompt"]
            for key in ("v1", "odd", "manual"):
                assert (await card_of(conn, "cards", cards[key]))["depth_prompt"] == ""
            assert (await card_of(conn, "cards", cards["done"]))["depth_prompt"] == "新导入的"
            old = await card_of(conn, "card_revisions", revision)
            assert old["depth_prompt"] == "{{char}} 嘴硬。\n第二行"
            opened = await card_of(conn, "workbench_drafts", drafts["opened"])
            assert opened["depth_prompt"] == "{{char}} 嘴硬。\n第二行"
            imported = await card_of(conn, "workbench_drafts", drafts["imported"])
            assert imported["depth_prompt"] == "草稿里的"

            for statement in m0028.statements(m0028.DOWN):
                await conn.execute(text(statement))
            assert "depth_prompt" not in await card_of(conn, "cards", cards["note"])
            assert "depth_prompt" not in await card_of(conn, "card_revisions", revision)
            assert "depth_prompt" not in await card_of(conn, "workbench_drafts", drafts["opened"])
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()
