"""编辑角色卡的端到端：真实 Postgres + 假模型服务 + 跑在 uvicorn 里的 api。

读取完整卡片 → 保存修改（预览跟着变）→ 旧版本号保存被拒 → 超长和空内容被拒 → 改名也会让版本号变
→ 新开的故事用的是改过的卡 → 恢复导入时的内容 → 只改显示名不算“已编辑”
→ 重新导入同一个文件打开的是已有剧本。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_scenario_edit.py
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from bettertavern.domain.scenario.card import MAX_FIELD_CHARS
from tests.e2e.m1_app import CARD, Running, read_events, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


async def import_card(client: httpx.AsyncClient, auth: dict[str, str]) -> httpx.Response:
    files = {"file": ("card.json", json.dumps(CARD).encode(), "application/json")}
    return await client.post("/v1/scenarios/import", headers=auth, files=files)


def edited(card: dict[str, Any], **changes: Any) -> dict[str, Any]:
    return {**card, **changes}


async def test_edit_card_round_trip(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        scenario = (await import_card(client, auth)).json()
        card_url = f"/v1/scenarios/{scenario['id']}/card"

        # 读取：卡片原文（宏原样），世界书按顺序
        r = await client.get(card_url, headers=auth)
        assert r.status_code == 200, r.text
        detail = r.json()
        assert detail["version"] == 1 and detail["edited_at"] is None
        assert detail["display_name"] == "阿苓"
        assert detail["card"]["description"].startswith("{{char}} 是灰石镇酒馆的帮工")
        assert detail["card"]["book"] == [
            {
                "name": "",
                "keys": ["火漆"],
                "content": "北境商会的火漆是黑色的。",
                "enabled": True,
                "constant": True,
            }
        ]

        # 保存：改描述、加标签、加一条世界书；显示名一起改
        new_entry = {"name": "渡口", "keys": ["子时"], "content": "子时才有船", "constant": False}
        card = edited(
            detail["card"],
            description="{{char}} 是渡口的船娘，替人摆渡。",
            tags=["渡口", " 雨夜 ", "渡口"],
            book=[*detail["card"]["book"], new_entry],
        )
        r = await client.put(
            card_url, headers=auth, json={"version": 1, "display_name": "雨夜阿苓", "card": card}
        )
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["version"] == 2 and saved["edited_at"] is not None
        assert saved["display_name"] == "雨夜阿苓"
        assert saved["card"]["tags"] == ["渡口", "雨夜"]
        assert [e["name"] for e in saved["card"]["book"]] == ["", "渡口"]
        assert saved["card"]["book"][1]["enabled"] is True

        # 剧本详情的预览跟着变
        overview = (await client.get(f"/v1/scenarios/{scenario['id']}", headers=auth)).json()
        assert overview["name"] == "雨夜阿苓"
        assert overview["description_preview"] == "阿苓 是渡口的船娘，替人摆渡。"
        assert overview["book_entries"] == 2 and overview["tags"] == ["渡口", "雨夜"]
        assert overview["version"] == 2 and overview["edited_at"] is not None

        # 拿着旧版本号保存：别处改过了，不覆盖
        r = await client.put(
            card_url, headers=auth, json={"version": 1, "display_name": "x", "card": card}
        )
        assert r.status_code == 409 and r.json()["code"] == "CARD_CHANGED"
        assert r.json()["version"] == 2

        # 不合格的内容：指出是哪个字段
        for bad, field in [
            (edited(card, name="  "), "name"),
            (edited(card, book=[{"content": "  "}]), "book.0.content"),
            (edited(card, personality="字" * (MAX_FIELD_CHARS + 1)), "personality"),
        ]:
            r = await client.put(
                card_url, headers=auth, json={"version": 2, "display_name": "雨夜阿苓", "card": bad}
            )
            assert r.status_code == 422, r.text
            assert r.json()["field"] == field
        r = await client.put(
            card_url, headers=auth, json={"version": 2, "display_name": " ", "card": card}
        )
        assert r.status_code == 422 and r.json()["field"] == "display_name"

        # 在列表里改名也算改过：版本号加 1，打开着的编辑页再保存会被拒
        r = await client.patch(
            f"/v1/scenarios/{scenario['id']}", headers=auth, json={"name": "阿苓·渡口"}
        )
        assert r.json()["version"] == 3

        # 新开的故事读的是改过的卡
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
        )
        await read_events(client, r.json()["events_url"], token)
        prompts = [
            "\n".join(str(m.get("content", "")) for m in req.body.get("messages", []))
            for req in running.fake.app.chat_requests
        ]
        world_prompt = next(p for p in prompts if "<character-card>" in p)
        assert "渡口的船娘" in world_prompt and "子时才有船" in world_prompt
        assert "灰石镇酒馆的帮工" not in world_prompt

        # 恢复导入时的内容：卡片回到原样，显示名不变
        r = await client.post(f"{card_url}/reset", headers=auth)
        assert r.status_code == 200, r.text
        restored = r.json()
        assert restored["version"] == 4 and restored["edited_at"] is None
        assert restored["display_name"] == "阿苓·渡口"
        assert restored["card"]["description"].startswith("{{char}} 是灰石镇酒馆的帮工")
        assert len(restored["card"]["book"]) == 1 and restored["card"]["tags"] == []

        # 在编辑页只改显示名：卡片内容没动，不算“已编辑”
        r = await client.put(
            card_url,
            headers=auth,
            json={"version": 4, "display_name": "阿苓", "card": restored["card"]},
        )
        assert r.status_code == 200, r.text
        assert r.json()["version"] == 5 and r.json()["edited_at"] is None
        assert r.json()["display_name"] == "阿苓"

        # 重新导入同一个文件：直接打开已有的剧本
        r = await import_card(client, auth)
        assert r.status_code == 200 and r.json()["duplicate"] is True
        assert r.json()["id"] == scenario["id"] and r.json()["version"] == 5


async def test_large_cards_can_be_saved(running: Running) -> None:
    """一张卡最多 30 万字：转义后的 JSON 超过一般接口的 1 MB，这个接口放宽到 4 MB"""
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        auth = {"Authorization": f"Bearer {account['token']}"}
        scenario = (await import_card(client, auth)).json()
        card_url = f"/v1/scenarios/{scenario['id']}/card"
        card = (await client.get(card_url, headers=auth)).json()["card"]
        big = "字" * MAX_FIELD_CHARS
        body = {
            "version": 1,
            "display_name": "阿苓",
            "card": edited(card, description=big, personality=big, scenario=big, first_mes=big),
        }
        payload = json.dumps(body)  # 中文转成 \\uXXXX，大约 1.4 MB
        assert len(payload) > 1024 * 1024
        r = await client.put(
            card_url,
            headers={**auth, "Content-Type": "application/json"},
            content=payload.encode(),
        )
        assert r.status_code == 200, r.text[:200]
        assert len(r.json()["card"]["description"]) == MAX_FIELD_CHARS


async def test_other_users_cannot_read_or_edit(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        auth = {"Authorization": f"Bearer {account['token']}"}
        scenario = (await import_card(client, auth)).json()
        r = await client.post(
            "/v1/auth/register", json={"email": "other@example.com", "password": "another pass 2"}
        )
        other = {"Authorization": f"Bearer {r.json()['access_token']}"}
        card_url = f"/v1/scenarios/{scenario['id']}/card"
        assert (await client.get(card_url, headers=other)).status_code == 404
        card = (await client.get(card_url, headers=auth)).json()["card"]
        r = await client.put(
            card_url, headers=other, json={"version": 1, "display_name": "偷改", "card": card}
        )
        assert r.status_code == 404
        assert (await client.post(f"{card_url}/reset", headers=other)).status_code == 404
        missing = f"/v1/scenarios/{uuid.uuid4()}/card"
        assert (await client.get(missing, headers=auth)).status_code == 404
