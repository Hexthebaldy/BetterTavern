"""迁移 0029：建人设库；剧本设置里写了默认主角的，按（用户、名字、描述）去重变成人设，
剧本选上它；能降级回去。

在只执行到 0028 的临时 schema 里写入剧本，再执行 0029 检查。
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


async def insert(conn: AsyncConnection, sql: str, **values: Any) -> str:
    return str((await conn.execute(text(sql), values)).scalar_one())


async def test_default_protagonists_become_personas_and_back() -> None:
    url = database_url()
    assert url is not None
    schema = f"test_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(normalize_url(url))
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = engine_for(url, schema, pool_size=1)
    modules = migrations()
    m0029 = next(m for m in modules if m.revision == "0029")
    try:
        async with engine.begin() as conn:
            for module in (m for m in modules if m.revision < "0029"):
                for statement in module.statements(module.DDL):
                    await conn.execute(text(statement))
            users = [
                await insert(
                    conn,
                    """INSERT INTO users (email, email_norm, password_hash)
                       VALUES (:e, :e, 'h') RETURNING id""",
                    e=email,
                )
                for email in ("a@x.cn", "b@x.cn")
            ]

            async def scenario(user: str, protagonist: dict[str, str] | None) -> str:
                setup = {"protagonist": protagonist} if protagonist is not None else {}
                return await insert(
                    conn,
                    """INSERT INTO scenarios (user_id, name, setup)
                       VALUES (:u, 'x', CAST(:s AS jsonb)) RETURNING id""",
                    u=user,
                    s=json.dumps(setup),
                )

            lin = {"name": "林川", "summary": "一名信使"}
            same = [await scenario(users[0], lin), await scenario(users[0], lin)]
            other_summary = await scenario(users[0], {"name": "林川", "summary": "另一个"})
            no_summary = await scenario(users[1], {"name": "沈砚"})
            empty = [
                await scenario(users[0], {"name": "", "summary": "x"}),
                await scenario(users[1], None),
            ]

            for statement in m0029.statements(m0029.DDL):
                await conn.execute(text(statement))

            rows = (
                (
                    await conn.execute(
                        text("SELECT id, user_id, name, description, is_default FROM personas")
                    )
                )
                .mappings()
                .all()
            )
            personas = {
                (str(r["user_id"]), r["name"], r["description"]): str(r["id"]) for r in rows
            }
            # 同一个用户名字和描述都一样的只建一个
            assert sorted(personas) == sorted(
                [
                    (users[0], "林川", "一名信使"),
                    (users[0], "林川", "另一个"),
                    (users[1], "沈砚", ""),
                ]
            )
            assert not any(r["is_default"] for r in rows)

            async def persona_of(scenario_id: str) -> str | None:
                setup = (
                    await conn.execute(
                        text("SELECT setup FROM scenarios WHERE id = :id"), {"id": scenario_id}
                    )
                ).scalar_one()
                return setup.get("persona_id")

            for sid in same:
                assert await persona_of(sid) == personas[(users[0], "林川", "一名信使")]
            assert await persona_of(other_summary) == personas[(users[0], "林川", "另一个")]
            assert await persona_of(no_summary) == personas[(users[1], "沈砚", "")]
            for sid in empty:
                assert await persona_of(sid) is None

            # 每个用户最多一个默认人设
            await conn.execute(
                text("UPDATE personas SET is_default = true WHERE id = :id"),
                {"id": personas[(users[0], "林川", "一名信使")]},
            )
            with pytest.raises(Exception, match="personas_default_uq"):
                async with conn.begin_nested():
                    await conn.execute(
                        text("UPDATE personas SET is_default = true WHERE id = :id"),
                        {"id": personas[(users[0], "林川", "另一个")]},
                    )

            for statement in m0029.statements(m0029.DOWN):
                await conn.execute(text(statement))
            assert await persona_of(same[0]) is None
            exists = (await conn.execute(text("SELECT to_regclass('personas')"))).scalar_one()
            assert exists is None
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()
