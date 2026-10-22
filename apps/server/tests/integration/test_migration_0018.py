"""迁移 0018：现有剧本拆成角色卡和剧本，各记一份版本，剧本引用自己那张卡；能降级回去。

在只执行到 0017 的临时 schema 里写入旧结构的数据，再执行 0018 检查搬过去的样子。
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from bettertavern.infra.db.engine import normalize_url
from tests.support.pg import database_url, engine_for, migrations

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

CARD = {"spec": "card_v2", "name": "阿苓", "description": "酒馆帮工"}


async def test_scenarios_are_split_into_cards_and_back() -> None:
    url = database_url()
    assert url is not None
    schema = f"test_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(normalize_url(url))
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = engine_for(url, schema, pool_size=1)
    modules = migrations()
    before = [m for m in modules if m.revision < "0018"]
    m0018 = next(m for m in modules if m.revision == "0018")
    try:
        async with engine.begin() as conn:
            for module in before:
                for statement in module.statements(module.DDL):
                    await conn.execute(text(statement))
            user = (
                await conn.execute(
                    text(
                        """INSERT INTO users (email, email_norm, password_hash)
                           VALUES ('a@x.cn', 'a@x.cn', 'h') RETURNING id"""
                    )
                )
            ).scalar_one()
            blob = (
                await conn.execute(
                    text(
                        """INSERT INTO blobs (user_id, sha256, mime, size, data)
                           VALUES (:u, 'f', 'image/png', 1, '\\x00') RETURNING id"""
                    ),
                    {"u": user},
                )
            ).scalar_one()
            ids = []
            # 同一个文件导入过两次（旧版本允许），另有一张没有文件指纹的
            olds = (("阿苓", "s1", blob, 1), ("阿苓 2", "s1", None, 2), ("另一张", None, None, 3))
            for name, sha, avatar, day in olds:
                row = await conn.execute(
                    text(
                        """INSERT INTO scenarios (user_id, name, source_kind, source_sha256, raw,
                                                  card, avatar_blob_id, version, created_at)
                           VALUES (:u, :n, 'card_v2', :sha, CAST(:raw AS jsonb),
                                   CAST(:card AS jsonb), :a, 3,
                                   TIMESTAMPTZ '2026-10-01' + make_interval(days => :d))
                           RETURNING id"""
                    ),
                    {
                        "u": user,
                        "n": name,
                        "sha": sha,
                        "raw": json.dumps(CARD),
                        "card": json.dumps(CARD),
                        "a": avatar,
                        "d": day,
                    },
                )
                ids.append(str(row.scalar_one()))
            for statement in m0018.statements(m0018.DDL):
                await conn.execute(text(statement))

            cards = (
                (
                    await conn.execute(
                        text(
                            """SELECT id, name, source, source_sha256, cover_blob_id, version
                               FROM cards"""
                        )
                    )
                )
                .mappings()
                .all()
            )
            # 卡的 id 沿用剧本的 id
            by_id = {str(c["id"]): c for c in cards}
            assert sorted(by_id) == sorted(ids)
            assert by_id[ids[0]]["source_sha256"] == "s1"
            assert by_id[ids[1]]["source_sha256"] is None  # 重复的指纹只留最早那张
            assert by_id[ids[0]]["cover_blob_id"] == blob
            assert all(c["version"] == 3 and c["source"] == "card_v2" for c in cards)
            revisions = (
                await conn.execute(text("SELECT card_id, version FROM card_revisions"))
            ).all()
            assert sorted((str(r[0]), r[1]) for r in revisions) == sorted((i, 3) for i in ids)
            links = (
                await conn.execute(
                    text("SELECT scenario_id, card_id, position FROM scenario_cards")
                )
            ).all()
            assert sorted((str(a), str(b), p) for a, b, p in links) == sorted(
                (i, i, 0) for i in ids
            )
            setup = (await conn.execute(text("SELECT DISTINCT setup FROM scenarios"))).scalar_one()
            assert setup == {}

            # 有剧本在用的卡删不掉
            with pytest.raises(Exception, match="scenario_cards"):
                async with conn.begin_nested():
                    await conn.execute(text("DELETE FROM cards WHERE id = :id"), {"id": ids[2]})

            for statement in m0018.statements(m0018.DOWN):
                await conn.execute(text(statement))
            rows = (
                (
                    await conn.execute(
                        text("SELECT id, source_kind, card, avatar_blob_id FROM scenarios")
                    )
                )
                .mappings()
                .all()
            )
            back = {str(r["id"]): r for r in rows}
            assert back[ids[0]]["avatar_blob_id"] == blob and back[ids[0]]["card"] == CARD
            assert back[ids[0]]["source_kind"] == "card_v2"
            exists = (await conn.execute(text("SELECT to_regclass('cards')"))).scalar_one()
            assert exists is None
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()
