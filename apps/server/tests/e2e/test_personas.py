"""人设库（F3）端到端：真实 Postgres + 跑在 uvicorn 里的 api。

新建、默认人设只有一个 → 剧本选人设（副本给旧版 App）→ 改人设时副本跟着改 → 头像（裁成正方形、
换掉的图删掉）→ 导入 SillyTavern 的人设备份 → 删人设时剧本不再选它 → 别人的人设看不到、选不了。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_personas.py
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

from tests.e2e.m1_app import Running, import_scenario, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


def png(size: tuple[int, int], color: tuple[int, int, int]) -> dict[str, Any]:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return {"file": ("me.png", out.getvalue(), "image/png")}


async def test_personas_and_the_scenarios_that_use_them(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        auth = {"Authorization": f"Bearer {(await setup_account(client, running.fake))['token']}"}

        r = await client.post(
            "/v1/personas", headers=auth, json={"name": " 林川 ", "description": "一名信使"}
        )
        assert r.status_code == 201, r.text
        lin = r.json()
        assert (lin["name"], lin["is_default"], lin["avatar_blob_id"]) == ("林川", False, None)
        r = await client.post(
            "/v1/personas", headers=auth, json={"name": "沈砚", "is_default": True}
        )
        shen = r.json()
        # 设成默认：原来的默认取消，默认人设排第一
        r = await client.patch(f"/v1/personas/{lin['id']}", headers=auth, json={"is_default": True})
        assert r.json()["is_default"] is True
        listed = (await client.get("/v1/personas", headers=auth)).json()
        assert [(p["name"], p["is_default"]) for p in listed] == [("林川", True), ("沈砚", False)]
        for bad, field in (
            ({"name": " "}, "name"),
            ({"name": "x", "description": "字" * 2001}, "description"),
        ):
            r = await client.post("/v1/personas", headers=auth, json=bad)
            assert r.status_code == 422 and r.json()["field"] == field

        # 剧本选人设：protagonist 写成它的副本（给旧版 App）
        saved: dict[str, Any] = await import_scenario(client, auth)
        sid = saved["scenario"]["id"]
        setup = {**saved["scenario"]["setup"], "persona_id": shen["id"]}
        r = await client.patch(f"/v1/scenarios/{sid}", headers=auth, json={"setup": setup})
        assert r.status_code == 200, r.text
        scenario = r.json()
        assert scenario["setup"]["persona_id"] == shen["id"]
        assert scenario["setup"]["protagonist"] == {"name": "沈砚", "summary": ""}
        missing = {**setup, "persona_id": "00000000-0000-0000-0000-000000000000"}
        r = await client.patch(f"/v1/scenarios/{sid}", headers=auth, json={"setup": missing})
        assert r.status_code == 422 and r.json()["field"] == "setup.persona_id"

        # 改人设：剧本里的副本跟着改，剧本的版本号不变
        r = await client.patch(
            f"/v1/personas/{shen['id']}", headers=auth, json={"description": "落魄书生"}
        )
        assert r.json()["scenario_count"] == 1
        after = (await client.get(f"/v1/scenarios/{sid}", headers=auth)).json()
        assert after["setup"]["protagonist"] == {"name": "沈砚", "summary": "落魄书生"}
        assert after["version"] == scenario["version"]

        # 头像：裁成 512 的正方形；换掉的图删掉
        r = await client.put(
            f"/v1/personas/{shen['id']}/avatar", headers=auth, files=png((300, 120), (200, 0, 0))
        )
        assert r.status_code == 200, r.text
        first = r.json()["avatar_blob_id"]
        image = await client.get(f"/v1/blobs/{first}", headers=auth)
        with Image.open(io.BytesIO(image.content)) as opened:
            assert opened.size == (512, 512)
        r = await client.put(
            f"/v1/personas/{shen['id']}/avatar", headers=auth, files=png((64, 64), (0, 0, 200))
        )
        second = r.json()["avatar_blob_id"]
        assert second != first
        assert (await client.get(f"/v1/blobs/{first}", headers=auth)).status_code == 404
        r = await client.put(
            f"/v1/personas/{shen['id']}/avatar",
            headers=auth,
            files={"file": ("x.png", b"not an image", "image/png")},
        )
        assert r.status_code == 422 and r.json()["code"] == "IMAGE_INVALID"

        # 导入 SillyTavern 的备份：和已有的一样的跳过；已经有默认人设，文件里的默认不算
        backup = {
            "personas": {"a.png": "林川", "b.png": "陆离", "c.png": ""},
            "persona_descriptions": {"a.png": {"description": "一名信使"}, "b.png": "说书人"},
            "default_persona": "b.png",
        }
        files = {"file": ("personas.json", json.dumps(backup).encode(), "application/json")}
        r = await client.post("/v1/personas/import", headers=auth, files=files)
        assert r.status_code == 201, r.text
        result = r.json()
        assert (result["created"], result["skipped"]) == (1, 2)
        assert [(p["name"], p["is_default"]) for p in result["personas"]] == [
            ("林川", True),
            ("沈砚", False),
            ("陆离", False),
        ]
        files = {"file": ("x.json", b"{}", "application/json")}
        r = await client.post("/v1/personas/import", headers=auth, files=files)
        assert r.status_code == 422 and r.json()["code"] == "PERSONA_BACKUP_INVALID"

        # 删人设：剧本不再选它，副本清空；头像删掉
        r = await client.delete(f"/v1/personas/{shen['id']}", headers=auth)
        assert r.status_code == 204
        after = (await client.get(f"/v1/scenarios/{sid}", headers=auth)).json()
        assert after["setup"]["persona_id"] is None
        assert after["setup"]["protagonist"] == {"name": "", "summary": ""}
        assert (await client.get(f"/v1/blobs/{second}", headers=auth)).status_code == 404

        # 别人的人设：看不到、改不了、选不了
        r = await client.post(
            "/v1/auth/register", json={"email": "other@example.com", "password": "correct horse 2"}
        )
        other = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert (await client.get("/v1/personas", headers=other)).json() == []
        r = await client.patch(f"/v1/personas/{lin['id']}", headers=other, json={"name": "x"})
        assert r.status_code == 404
        assert (await client.delete(f"/v1/personas/{lin['id']}", headers=other)).status_code == 404
        theirs: dict[str, Any] = await import_scenario(client, other)
        setup = {**theirs["scenario"]["setup"], "persona_id": lin["id"]}
        r = await client.patch(
            f"/v1/scenarios/{theirs['scenario']['id']}", headers=other, json={"setup": setup}
        )
        assert r.status_code == 422
