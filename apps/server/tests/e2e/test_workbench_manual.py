"""工作台手动模式、角色卡仓库和剧本仓库的端到端：真实 Postgres + 跑在 uvicorn 里的 api。

导入成草稿 → 自动保存（宽松模式、版本围栏）→ 保存前检查 → 保存进仓库（顺便建剧本）→ 剧本设置预填开局
→ 从仓库打开同一张卡接着用那份草稿 → 卡在别处改过时保存冲突，覆盖或另存 → 版本历史和恢复
→ 有剧本在用的卡删不掉 → 封面上传、版权确认 → 导出的 PNG 能再导入。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_workbench_manual.py
"""

from __future__ import annotations

import io
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image

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


def card_body(card: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """草稿响应里的卡片 → 自动保存的请求体（只取能编辑的字段）。"""
    fields = (
        "name",
        "description",
        "personality",
        "scenario",
        "first_mes",
        "mes_example",
        "system_prompt",
        "creator_notes",
        "alternate_greetings",
        "tags",
        "book",
    )
    return {**{f: card[f] for f in fields}, **changes}


def png_bytes(size: tuple[int, int] = (300, 300)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(out, format="PNG")
    return out.getvalue()


async def test_manual_draft_to_card_to_scenario(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}

        # 导入：变成草稿，不进仓库
        data = json.dumps(CARD, ensure_ascii=False).encode()
        r = await client.post(
            "/v1/workbench/drafts/import",
            headers=auth,
            files={"file": ("card.json", data, "text/json")},
            data={"language": "zh"},
        )
        assert r.status_code == 201, r.text
        draft = r.json()["draft"]
        draft_id = draft["draft"]["id"]
        assert draft["draft"]["origin"] == "import_file" and draft["draft"]["unsaved"] is True
        assert draft["card"]["name"] == "阿苓" and draft["card"]["book"][0]["keys"] == ["火漆"]
        assert (await client.get("/v1/cards", headers=auth)).json() == []
        listed = (await client.get("/v1/workbench/drafts", headers=auth)).json()
        assert [d["id"] for d in listed] == [draft_id]

        # 自动保存：宽松模式，名字可以暂时为空；检查结果里是 error
        url = f"/v1/workbench/drafts/{draft_id}/card"
        body = {"version": 1, "name": "", "card": card_body(draft["card"], name="")}
        r = await client.put(url, headers=auth, json=body)
        assert r.status_code == 200, r.text
        assert r.json()["draft"]["version"] == 2
        assert {"field": "name", "code": "name_empty", "level": "error", "params": {}} in r.json()[
            "issues"
        ]
        # 旧版本号被拒
        r = await client.put(url, headers=auth, json=body)
        assert r.status_code == 409 and r.json()["code"] == "DRAFT_CHANGED"
        assert r.json()["version"] == 2
        # 超长照样拒绝
        long = card_body(draft["card"], personality="字" * (MAX_FIELD_CHARS + 1))
        r = await client.put(url, headers=auth, json={"version": 2, "name": "", "card": long})
        assert r.status_code == 422 and r.json()["field"] == "personality"

        # 保存前检查：名字为空不能保存
        save_url = f"/v1/workbench/drafts/{draft_id}/save"
        r = await client.post(save_url, headers=auth, json={})
        assert r.status_code == 422 and r.json()["code"] == "CARD_CHECK_FAILED"
        assert [i["code"] for i in r.json()["issues"]] == ["display_name_empty", "name_empty"]

        fixed = card_body(
            draft["card"],
            name="阿苓",
            alternate_greetings=["雨停了。", ""],
            creator_notes="原卡来自导入",
        )
        r = await client.put(url, headers=auth, json={"version": 2, "name": "", "card": fixed})
        assert r.status_code == 200, r.text

        # 保存进仓库，顺便建剧本（“保存并开始新故事”）
        r = await client.post(save_url, headers=auth, json={"new_scenario": True})
        assert r.status_code == 200, r.text
        saved = r.json()
        card_id = saved["card"]["id"]
        assert saved["card"]["name"] == "阿苓"  # 显示名为空时用角色名
        assert saved["card"]["source"] == "card_v2" and saved["card"]["version"] == 1
        assert saved["card"]["greetings"] == 2  # 空的备选开场白保存时去掉
        assert saved["draft"]["draft"]["unsaved"] is False
        scenario = saved["scenario"]
        assert scenario["name"] == "阿苓"
        assert [c["card_id"] for c in scenario["cards"]] == [card_id]
        assert (await client.get("/v1/workbench/drafts", headers=auth)).json() == []

        detail = (await client.get(f"/v1/cards/{card_id}", headers=auth)).json()
        assert detail["content"]["alternate_greetings"] == ["雨停了。"]
        assert detail["content"]["creator_notes"] == "原卡来自导入"
        assert detail["scenarios"] == [{"id": scenario["id"], "name": "阿苓"}]

        # 剧本的设置：默认主角、偏好、开场白；开局时不填主角就用它
        sid = scenario["id"]
        r = await client.patch(
            f"/v1/scenarios/{sid}",
            headers=auth,
            json={
                "name": "雨夜酒馆",
                "version": scenario["version"],
                "setup": {
                    "protagonist": {"name": "林川", "summary": "一名信使"},
                    "preferences": {"length": "short", "style": "白描"},
                    "opening": {"card_id": card_id, "greeting": 1},
                },
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["setup"]["opening"] == {"card_id": card_id, "greeting": 1}
        r = await client.patch(
            f"/v1/scenarios/{sid}", headers=auth, json={"name": "又一次", "version": 1}
        )
        assert r.status_code == 409 and r.json()["code"] == "SCENARIO_CHANGED"
        r = await client.patch(
            f"/v1/scenarios/{sid}",
            headers=auth,
            json={"setup": {"opening": {"card_id": card_id, "greeting": 5}}},
        )
        assert r.status_code == 422 and r.json()["field"] == "setup.opening"

        r = await client.post("/v1/playthroughs", headers=auth, json={"scenario_id": sid})
        assert r.status_code == 202, r.text
        created = r.json()
        assert created["playthrough"]["protagonist_name"] == "林川"
        assert created["playthrough"]["preferences"]["length"] == "short"
        assert created["playthrough"]["title"] == "雨夜酒馆"
        await read_events(client, created["events_url"], token)

        # 从仓库打开同一张卡：接着用那份草稿
        r = await client.post(
            "/v1/workbench/drafts", headers=auth, json={"origin": "edit_card", "card_id": card_id}
        )
        assert r.status_code == 201, r.text
        assert r.json()["draft"]["id"] == draft_id
        version = r.json()["draft"]["version"]
        edited = card_body(r.json()["card"], personality="嘴硬心软，其实很怕黑")
        r = await client.put(
            url, headers=auth, json={"version": version, "name": "", "card": edited}
        )
        assert r.status_code == 200
        listed = (await client.get("/v1/cards", headers=auth)).json()
        assert listed[0]["draft_id"] == draft_id and listed[0]["scenario_count"] == 1

        # 在别处改了卡（恢复成第 1 版也算一次保存），草稿再保存就冲突
        r = await client.post(f"/v1/cards/{card_id}/revisions/1/restore", headers=auth)
        assert r.status_code == 200 and r.json()["card"]["version"] == 2
        r = await client.post(save_url, headers=auth, json={})
        assert r.status_code == 409 and r.json()["code"] == "CARD_CHANGED"
        assert r.json()["version"] == 2
        # 另存成新卡
        r = await client.post(save_url, headers=auth, json={"on_conflict": "copy"})
        assert r.status_code == 200, r.text
        copy_id = r.json()["card"]["id"]
        assert copy_id != card_id
        # 原卡不受影响；再覆盖一次
        r = await client.put(
            url,
            headers=auth,
            json={"version": r.json()["draft"]["draft"]["version"], "name": "", "card": edited},
        )
        r = await client.post(
            "/v1/workbench/drafts", headers=auth, json={"origin": "edit_card", "card_id": card_id}
        )
        other_draft = r.json()["draft"]["id"]
        assert other_draft != draft_id  # 原卡没有草稿了（那份草稿现在对着新卡）
        r = await client.put(
            f"/v1/workbench/drafts/{other_draft}/card",
            headers=auth,
            json={"version": r.json()["draft"]["version"], "name": "阿苓", "card": edited},
        )
        r = await client.post(f"/v1/workbench/drafts/{other_draft}/save", headers=auth, json={})
        assert r.status_code == 200 and r.json()["card"]["version"] == 3

        revisions = (await client.get(f"/v1/cards/{card_id}/revisions", headers=auth)).json()
        assert [v["version"] for v in revisions] == [3, 2, 1]
        assert revisions[1]["note"] == "restore:1" and revisions[0]["from_draft"] is True

        # 有剧本在用的卡删不掉；删了剧本就能删
        r = await client.delete(f"/v1/cards/{card_id}", headers=auth)
        assert r.status_code == 409 and r.json()["code"] == "CARD_IN_USE"
        assert r.json()["scenarios"] == [{"id": sid, "name": "雨夜酒馆"}]
        assert (await client.delete(f"/v1/scenarios/{sid}", headers=auth)).status_code == 204
        assert (await client.delete(f"/v1/cards/{card_id}", headers=auth)).status_code == 204
        # 指向它的草稿还在，card_id 置空
        r = await client.get(f"/v1/workbench/drafts/{other_draft}", headers=auth)
        assert r.status_code == 200 and r.json()["draft"]["card_id"] is None

        # 同一个文件再导入：先问是打开已有的卡（copy_id 没有文件指纹，原卡已删）还是另起一份
        r = await client.post(
            "/v1/workbench/drafts/import",
            headers=auth,
            files={"file": ("card.json", data, "text/json")},
        )
        assert r.status_code == 201  # 没有卡记着这个文件指纹了


async def test_cover_scenarios_and_export(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        auth = {"Authorization": f"Bearer {account['token']}"}

        # 手动新建：空白草稿
        r = await client.post(
            "/v1/workbench/drafts", headers=auth, json={"origin": "manual", "language": "en"}
        )
        assert r.status_code == 201, r.text
        draft = r.json()
        draft_id = draft["draft"]["id"]
        assert draft["card"]["name"] == "" and draft["language"] == "en"
        assert draft["draft"]["mode"] == "manual"

        # 上传封面：不是图片的拒绝；图片去掉 EXIF 重新编码
        base = f"/v1/workbench/drafts/{draft_id}"
        r = await client.post(
            f"{base}/assets", headers=auth, files={"file": ("x.gif", b"GIF89a", "image/gif")}
        )
        assert r.status_code == 422 and r.json()["code"] == "IMAGE_INVALID"
        r = await client.post(
            f"{base}/assets", headers=auth, files={"file": ("c.png", png_bytes(), "image/png")}
        )
        assert r.status_code == 201, r.text
        asset = r.json()
        assert asset["license"] == "own" and (asset["width"], asset["height"]) == (300, 300)
        r = await client.put(f"{base}/cover", headers=auth, json={"asset_id": asset["id"]})
        assert r.status_code == 200 and r.json()["cover_asset_id"] == asset["id"]

        body = {
            "version": r.json()["draft"]["version"],
            "name": "Wen Jiu",
            "card": {
                "name": "温九",
                "description": "长生当的掌柜",
                "first_mes": "客官当什么？",
                "book": [{"name": "规矩", "content": "三不当", "constant": True}],
            },
        }
        r = await client.put(f"{base}/card", headers=auth, json=body)
        assert r.status_code == 200, r.text
        assert [i for i in r.json()["issues"] if i["level"] == "error"] == []
        r = await client.patch(base, headers=auth, json={"mode": "agent"})
        assert r.status_code == 200 and r.json()["draft"]["mode"] == "agent"
        assert r.json()["draft"]["version"] == body["version"] + 1  # 切模式不算修改

        r = await client.post(f"{base}/save", headers=auth, json={})
        assert r.status_code == 200, r.text
        card = r.json()["card"]
        assert card["name"] == "Wen Jiu" and card["character_name"] == "温九"
        assert card["source"] == "manual" and card["made_by"] == "manual"
        assert card["cover_blob_id"] == asset["blob_id"]
        r = await client.get(f"/v1/blobs/{card['cover_blob_id']}", headers=auth)
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"

        # 再做一张卡，建群像剧本；第一张是主角色卡
        r = await client.post("/v1/workbench/drafts", headers=auth, json={"origin": "manual"})
        second = r.json()["draft"]["id"]
        r = await client.put(
            f"/v1/workbench/drafts/{second}/card",
            headers=auth,
            json={"version": 1, "name": "", "card": {"name": "阿七", "first_mes": "掌柜的！"}},
        )
        r = await client.post(f"/v1/workbench/drafts/{second}/save", headers=auth, json={})
        second_card = r.json()["card"]["id"]
        r = await client.post(
            "/v1/scenarios",
            headers=auth,
            json={
                "card_ids": [card["id"], second_card, card["id"]],
                "setup": {"opening": {"card_id": second_card, "greeting": 0}},
            },
        )
        assert r.status_code == 201, r.text
        scenario = r.json()
        assert scenario["name"] == "Wen Jiu" and scenario["cover_blob_id"] == asset["blob_id"]
        assert [c["card_id"] for c in scenario["cards"]] == [card["id"], second_card]
        r = await client.post(
            "/v1/scenarios", headers=auth, json={"card_ids": [card["id"], "nope"]}
        )
        assert r.status_code == 404
        r = await client.post("/v1/scenarios", headers=auth, json={"card_ids": []})
        assert r.status_code == 422

        # 导出 PNG：再导入是同一张卡
        r = await client.get(f"/v1/cards/{card['id']}/export", headers=auth)
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"
        assert "attachment" in r.headers["content-disposition"]
        exported = r.content
        with Image.open(io.BytesIO(exported)) as image:
            assert image.size == (512, 768)
        r = await client.post(
            "/v1/workbench/drafts/import",
            headers=auth,
            files={"file": ("wen.png", exported, "image/png")},
        )
        assert r.status_code == 201, r.text
        again = r.json()["draft"]
        assert again["card"]["name"] == "温九" and again["card"]["book"][0]["content"] == "三不当"
        assert again["cover_asset_id"] is not None
        r = await client.get(f"/v1/cards/{card['id']}/export?format=json", headers=auth)
        assert r.json()["spec"] == "chara_card_v3"
        assert r.json()["data"]["extensions"]["bettertavern"]["card_id"] == card["id"]

        # 删草稿：仓库里的卡不受影响，封面还在
        assert (await client.delete(base, headers=auth)).status_code == 204
        r = await client.get(f"/v1/blobs/{card['cover_blob_id']}", headers=auth)
        assert r.status_code == 200
        assert (await client.get(base, headers=auth)).status_code == 404


async def make_card(client: httpx.AsyncClient, auth: dict[str, str], card: dict[str, Any]) -> str:
    r = await client.post("/v1/workbench/drafts", headers=auth, json={"origin": "manual"})
    draft_id = r.json()["draft"]["id"]
    r = await client.put(
        f"/v1/workbench/drafts/{draft_id}/card",
        headers=auth,
        json={"version": 1, "name": "", "card": card},
    )
    assert r.status_code == 200, r.text
    r = await client.post(f"/v1/workbench/drafts/{draft_id}/save", headers=auth, json={})
    assert r.status_code == 200, r.text
    return str(r.json()["card"]["id"])


async def test_ensemble_scenario_opens_with_the_chosen_greeting(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        ling = await make_card(
            client,
            auth,
            {
                "name": "阿苓",
                "description": "{{char}} 是酒馆的帮工",
                "first_mes": "外乡人？",
                "book": [{"name": "火漆", "keys": ["火漆"], "content": "北境商会的火漆是黑色的"}],
            },
        )
        zhou = await make_card(
            client,
            auth,
            {
                "name": "老周",
                "description": "{{char}} 是掌柜",
                "first_mes": "要点什么？",
                "alternate_greetings": ["*老周放下抹布* {{user}}，你的信我收着呢。"],
            },
        )
        r = await client.post(
            "/v1/scenarios",
            headers=auth,
            json={
                "card_ids": [ling, zhou],
                "setup": {
                    "protagonist": {"name": "林川"},
                    "opening": {"card_id": zhou, "greeting": 1},
                },
            },
        )
        assert r.status_code == 201, r.text
        scenario = r.json()
        assert [c["name"] for c in scenario["cards"]] == ["阿苓", "老周"]
        # 卡在用：删不掉
        r = await client.delete(f"/v1/cards/{zhou}", headers=auth)
        assert r.status_code == 409

        r = await client.post(
            "/v1/playthroughs", headers=auth, json={"scenario_id": scenario["id"]}
        )
        assert r.status_code == 202, r.text
        created = r.json()
        events = await read_events(client, created["events_url"], token)
        completed = json.loads(events[-1].data)["turn"]
        # 开场就是选定的开场白（宏换成名字、动作换成括号），导演没有重写
        assert completed["narrative"] == "（老周放下抹布）林川，你的信我收着呢。"
        assert [o["text"] for o in completed["options"]] == ["修复的选项一", "修复的选项二"]
        assert running.story.director_calls == 0
        # WorldBuilder 拿到了两张卡，开场白作为故事的开头
        world_request = next(
            r
            for r in running.fake.app.chat_requests
            if "<character-card>" in json.dumps(r.body, ensure_ascii=False)
        )
        prompt = world_request.body["messages"][-1]["content"]
        assert "另一位关键人物：老周" in prompt and "北境商会的火漆" in prompt
        assert "故事就从这段开场白开始" in prompt
        world = (
            await client.get(f"/v1/playthroughs/{created['playthrough']['id']}/world", headers=auth)
        ).json()
        names = {e["name"] for e in world["entities"] if e["kind"] == "character"}
        assert {"阿苓", "老周"} <= names
