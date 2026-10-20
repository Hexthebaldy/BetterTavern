"""用假模型服务把剧本试玩脚本完整跑一遍：开局、几回合、后台整理、等追上、分析。

需要 Postgres（make test-integration）。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy, ProviderHub
from evals.playtest import ModelChoice, ReplayConfig, run_replay
from tests.fakes.llm_server import RunningFakeLLM
from tests.fakes.story_llm import StoryScript
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


async def test_replay_runs_end_to_end_with_a_fake_model(
    fake_llm: RunningFakeLLM, tmp_path: Path
) -> None:
    assert URL is not None
    story = StoryScript(piece_delay=0.0)
    fake_llm.app.default_reply = story.reply
    policy = EndpointPolicy(allow_private=True)
    secrets = load_secrets(
        master_keys=new_master_key_entry("t1"),
        auth_secret="s" * 40,
        allow_dev_fallback=False,
        data_dir=tmp_path,
    )
    model = ModelChoice(
        "custom_openai",
        "fake-model",
        "sk-test-123456",
        base_url=fake_llm.base_url,
        caps_override={"tools": True},  # 自定义端点默认不能调用工具
    )
    config = ReplayConfig(director=model, turns=4, think_s=0.0, settle_s=30.0)
    async with schema_engine(URL, pool_size=10) as engine:
        hub = ProviderHub(policy=policy)
        try:
            result = await run_replay(
                config, engine=engine, secrets=secrets, hub=hub, policy=policy, say=lambda _: None
            )
        finally:
            await hub.aclose()
    summary = result.summary
    assert summary["turns"] == 5  # 开场加 4 回合
    assert summary["state"]["processed_to"] == 4 and summary["state"]["caught_up"]
    assert summary["state"]["runs"] == {"ok": 5}
    assert summary["consistency"]["turns_with_new_issues"] == {}
    assert summary["director"]["runs"] == 5
    # 假导演每回合都给选项；剧本的检查点都在第 15 回合以后，这里只跑 4 回合，全都判没整理到
    assert summary["options"]["passed"] is True
    assert summary["checks"]["passed"] == 0 and summary["checks"]["total"] == 10
    assert story.state_calls == 5
    # 第 1 回合剧本是自己写的行动，第 2 回合是点选项
    assert [t.source for t in result.turns[1:3]] == ["text", "option"]
