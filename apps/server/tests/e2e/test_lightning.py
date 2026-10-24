"""闪电模式（docs/agent-runtime.md 的“闪电模式”）：剧本的设置里打开，开局时定下，之后不变。

真的 api + 假模型服务（m1_app），在临时 schema 里跑。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from tests.e2e.m1_app import Running, import_scenario, read_events, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


async def set_lightning(
    client: httpx.AsyncClient, auth: dict[str, str], scenario: dict[str, Any], on: bool
) -> dict[str, Any]:
    setup: dict[str, Any] = {**scenario["setup"], "lightning": on}
    r = await client.patch(
        f"/v1/scenarios/{scenario['id']}",
        headers=auth,
        json={"setup": setup, "version": scenario["version"]},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_mode_is_taken_from_the_scenario_at_start_and_never_changes(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        saved: dict[str, Any] = await import_scenario(client, auth)
        scenario: dict[str, Any] = saved["scenario"]
        assert scenario["setup"]["lightning"] is False

        scenario = await set_lightning(client, auth, scenario, True)
        assert scenario["setup"]["lightning"] is True
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        created = r.json()
        assert created["playthrough"]["mode"] == "lightning"
        await read_events(client, created["events_url"], token)
        lightning_id = created["playthrough"]["id"]

        # 剧本改回普通：已经开始的这一局还是闪电，新开的是普通
        scenario = await set_lightning(client, auth, scenario, False)
        r = await client.get(f"/v1/playthroughs/{lightning_id}", headers=auth)
        assert r.json()["playthrough"]["mode"] == "lightning"
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        assert r.json()["playthrough"]["mode"] == "standard"
        modes = {
            p["id"]: p["mode"] for p in (await client.get("/v1/playthroughs", headers=auth)).json()
        }
        assert modes[lightning_id] == "lightning"
