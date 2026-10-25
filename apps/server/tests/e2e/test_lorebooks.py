"""世界书仓库的端到端（docs/lorebook.md）：真实 Postgres + 跑在 uvicorn 里的 api。

导入 SillyTavern 的世界书 → 重复导入先问 → 新建空白的 → 改条目（版本围栏、宽松、上限）→ 改名
→ 挂到剧本（上限、顺序、别人的书）→ 删书时从剧本上摘掉。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_lorebooks.py
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from tests.e2e.m1_app import Running, import_scenario, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

WORLD = {
    "entries": {
        "0": {
            "uid": 0,
            "key": ["青石渡", "渡口"],
            "keysecondary": ["夜里"],
            "selectiveLogic": 0,
            "comment": "青石渡",
            "content": "青石渡是江边小镇，入夜后只剩最后一班船。",
            "constant": False,
            "order": 120,
            "disable": False,
            "displayIndex": 0,
            "probability": 100,
            "useProbability": True,
            "sticky": 4,
        },
        "1": {
            "uid": 1,
            "key": [],
            "comment": "背景",
            "content": "这是一个没有法术的架空王朝。",
            "constant": True,
            "order": 100,
            "displayIndex": 1,
        },
        "2": {"uid": 2, "key": ["空的"], "content": "   ", "displayIndex": 2},
    }
}


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


def file_of(data: dict[str, Any], name: str = "雨夜渡口.json") -> dict[str, Any]:
    return {"file": (name, json.dumps(data, ensure_ascii=False).encode(), "application/json")}


async def test_import_edit_attach_and_delete(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        auth = {"Authorization": f"Bearer {(await setup_account(client, running.fake))['token']}"}

        # 导入：书名用文件名，没正文的条目丢掉，设置照 ST
        r = await client.post("/v1/lorebooks/import", headers=auth, files=file_of(WORLD))
        assert r.status_code == 201, r.text
        detail = r.json()["lorebook"]
        book = detail["lorebook"]
        book_id = book["id"]
        assert (book["name"], book["source"], book["entries"], book["constant"]) == (
            "雨夜渡口",
            "st_world",
            2,
            1,
        )
        assert book["report"]["dropped_empty"] == 1 and book["version"] == 1
        first = detail["book"][0]
        assert first["keys"] == ["青石渡", "渡口"] and first["secondary_keys"] == ["夜里"]
        assert first["priority"] == 120 and first["rules"]["sticky"] == 2
        assert detail["scenarios"] == []

        # 同一个文件再导入：先问
        r = await client.post("/v1/lorebooks/import", headers=auth, files=file_of(WORLD))
        assert r.status_code == 200 and r.json()["lorebook"] is None
        assert r.json()["existing"]["id"] == book_id
        r = await client.post(
            "/v1/lorebooks/import",
            headers=auth,
            files=file_of(WORLD),
            data={"allow_duplicate": "true"},
        )
        assert r.status_code == 201 and r.json()["lorebook"]["lorebook"]["id"] != book_id
        copy_id = r.json()["lorebook"]["lorebook"]["id"]

        # 不是世界书
        card = {"spec": "chara_card_v2", "data": {"name": "阿苓", "first_mes": "你好"}}
        r = await client.post("/v1/lorebooks/import", headers=auth, files=file_of(card))
        assert r.status_code == 422 and r.json()["code"] == "LOREBOOK_IS_CARD"
        r = await client.post(
            "/v1/lorebooks/import",
            headers=auth,
            files={"file": ("x.json", b"{broken", "application/json")},
        )
        assert r.status_code == 422 and r.json()["code"] == "LOREBOOK_INVALID"

        # 新建空白的
        r = await client.post("/v1/lorebooks", headers=auth, json={"name": "  修仙  设定 "})
        assert r.status_code == 201, r.text
        blank = r.json()
        assert blank["lorebook"]["name"] == "修仙 设定" and blank["lorebook"]["report"] is None
        assert blank["lorebook"]["source"] == "manual" and blank["book"] == []
        r = await client.post("/v1/lorebooks", headers=auth, json={"name": " "})
        assert r.status_code == 422 and r.json()["field"] == "name"

        # 改条目：整本发过去，宽松（正文可以空着），设置跟着条目走
        entries = detail["book"]
        moved = [entries[1], {**entries[0], "content": "改过的渡口"}, {"name": "还没写"}]
        url = f"/v1/lorebooks/{book_id}/book"
        r = await client.put(url, headers=auth, json={"version": 1, "book": moved})
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["lorebook"]["version"] == 2 and saved["lorebook"]["entries"] == 3
        assert [e["name"] for e in saved["book"]] == ["背景", "青石渡", "还没写"]
        assert saved["book"][1]["priority"] == 120 and saved["book"][1]["rules"]["sticky"] == 2
        # 拿旧版本号再存：别处改过了
        r = await client.put(url, headers=auth, json={"version": 1, "book": moved})
        assert r.status_code == 409 and r.json()["code"] == "LOREBOOK_CHANGED"
        assert r.json()["version"] == 2
        # 超过上限：指出字段
        too_long = [{"content": "有", "keys": ["长" * 301]}]
        r = await client.put(url, headers=auth, json={"version": 2, "book": too_long})
        assert r.status_code == 422 and r.json()["field"] == "book.0.keys"

        # 改名
        r = await client.patch(
            f"/v1/lorebooks/{book_id}",
            headers=auth,
            json={"name": "青石渡设定", "description": "渡口和镇上的人", "version": 2},
        )
        assert r.status_code == 200 and r.json()["lorebook"]["version"] == 3
        r = await client.patch(f"/v1/lorebooks/{book_id}", headers=auth, json={"version": 2})
        assert r.status_code == 409

        # 挂到剧本
        saved_card: dict[str, Any] = await import_scenario(client, auth)
        sid = saved_card["scenario"]["id"]
        r = await client.patch(
            f"/v1/scenarios/{sid}",
            headers=auth,
            json={"lorebook_ids": [blank["lorebook"]["id"], book_id, book_id]},
        )
        assert r.status_code == 200, r.text
        scenario = r.json()
        assert [b["name"] for b in scenario["lorebooks"]] == ["修仙 设定", "青石渡设定"]
        assert scenario["lorebooks"][1]["entries"] == 3
        listed = (await client.get("/v1/lorebooks", headers=auth)).json()
        assert {b["id"]: b["scenario_count"] for b in listed}[book_id] == 1
        r = await client.get(f"/v1/lorebooks/{book_id}", headers=auth)
        assert r.json()["scenarios"] == [{"id": sid, "name": scenario["name"]}]
        # 最多 4 本、不存在的书
        five = [book_id, copy_id, blank["lorebook"]["id"], "a", "b"]
        r = await client.patch(f"/v1/scenarios/{sid}", headers=auth, json={"lorebook_ids": five})
        assert r.status_code == 422 and r.json()["field"] == "lorebook_ids"
        missing = "00000000-0000-0000-0000-000000000000"
        r = await client.patch(
            f"/v1/scenarios/{sid}", headers=auth, json={"lorebook_ids": [missing]}
        )
        assert r.status_code == 404

        # 删书：从剧本上摘掉，剧本还在
        assert (await client.delete(f"/v1/lorebooks/{book_id}", headers=auth)).status_code == 204
        r = await client.get(f"/v1/scenarios/{sid}", headers=auth)
        assert [b["name"] for b in r.json()["lorebooks"]] == ["修仙 设定"]
        assert (await client.get(f"/v1/lorebooks/{book_id}", headers=auth)).status_code == 404


async def test_other_users_cannot_see_or_attach(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        auth = {"Authorization": f"Bearer {(await setup_account(client, running.fake))['token']}"}
        r = await client.post("/v1/lorebooks", headers=auth, json={"name": "我的书"})
        book_id = r.json()["lorebook"]["id"]
        r = await client.post(
            "/v1/auth/register", json={"email": "other@example.com", "password": "correct horse 2"}
        )
        other = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert (await client.get(f"/v1/lorebooks/{book_id}", headers=other)).status_code == 404
        assert (await client.get("/v1/lorebooks", headers=other)).json() == []
        saved: dict[str, Any] = await import_scenario(client, other)
        r = await client.patch(
            f"/v1/scenarios/{saved['scenario']['id']}",
            headers=other,
            json={"lorebook_ids": [book_id]},
        )
        assert r.status_code == 404
        assert (await client.delete(f"/v1/lorebooks/{book_id}", headers=other)).status_code == 404
