"""用假模型服务把剧本试玩脚本完整跑一遍：开局、几回合、后台整理、等追上、分析。

需要 Postgres（make test-integration）。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from bettertavern.domain.memory.chapters import ChapterRule
from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy, ProviderHub
from bettertavern.runtime.lightning_runner import LightningRunnerConfig
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
    # 后台写了第一版大纲；假的世界状态 agent 从不说“要改”，所以只写这一次
    assert summary["outline"]["first_seq"] is not None and summary["outline"]["revised"] == 0
    assert story.outline_calls == 1
    # 第 1 回合剧本是自己写的行动，第 2 回合是点选项
    assert [t.source for t in result.turns[1:3]] == ["text", "option"]


async def test_director_recalls_through_the_real_stream_format(
    fake_llm: RunningFakeLLM, tmp_path: Path
) -> None:
    """切章的线很低，几回合就写一章：之后导演有召回工具，先查一次再写
    （工具调用走真实的流式格式）。"""
    assert URL is not None
    story = StoryScript(piece_delay=0.0, recall=True)
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
        caps_override={"tools": True},
    )
    # 每回合之间停一下，让世界状态跟上：没整理的回合不会移出上下文
    config = ReplayConfig(
        director=model,
        turns=6,
        think_s=0.5,
        settle_s=30.0,
        chapter_rule=ChapterRule(soft_tokens=60, hard_tokens=150),
    )
    async with schema_engine(URL, pool_size=10) as engine:
        hub = ProviderHub(policy=policy)
        try:
            result = await run_replay(
                config, engine=engine, secrets=secrets, hub=hub, policy=policy, say=lambda _: None
            )
        finally:
            await hub.aclose()
    recall = result.summary["recall"]
    assert recall["offered_turns"] >= 1
    assert recall["used_turns"] == recall["offered_turns"] == story.recall_calls
    assert recall["tool_calls"] == {"recall": story.recall_calls}
    # 查过以后照样写完，每回合都有叙述和选项
    assert result.summary["director"]["runs"] == 7
    # 章节整理也跑了：写了章节摘要，导演的上下文里有回顾
    assert result.summary["memory"]["runs"].get("ok", 0) >= 1 and story.chapter_calls >= 1
    assert all(t.narrative for t in result.turns)


async def test_lightning_replay_compresses_with_the_directors_model(
    fake_llm: RunningFakeLLM, tmp_path: Path
) -> None:
    """闪电模式玩同一份剧本：只有导演，压缩的线很低，几回合就压一次梗概；
    不跑世界状态 agent 和大纲，检查点不算，报告里有压缩和花费。"""
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
    model = ModelChoice("custom_openai", "fake-model", "sk-test-123456", base_url=fake_llm.base_url)
    config = ReplayConfig(
        director=model,
        turns=6,
        think_s=0.2,
        settle_s=30.0,
        lightning=True,
        lightning_config=LightningRunnerConfig(compress_tokens=300, keep_tokens=100, keep_turns=2),
    )
    async with schema_engine(URL, pool_size=10) as engine:
        hub = ProviderHub(policy=policy)
        try:
            result = await run_replay(
                config, engine=engine, secrets=secrets, hub=hub, policy=policy, say=lambda _: None
            )
        finally:
            await hub.aclose()
    summary = result.summary
    assert summary["mode"] == "lightning" and summary["verdict"]["passed"]
    assert summary["turns"] == 7 and summary["director"]["runs"] == 7
    assert summary["checks"]["total"] == 0
    assert story.state_calls == 0 and story.outline_calls == 0 and story.chapter_calls == 0
    compressed = summary["lightning"]
    assert story.compress_calls >= 1
    assert compressed["runs"] == {"ok": story.compress_calls}
    assert compressed["synopsis_versions"] == story.compress_calls
    assert summary["cost"]["by_agent"]["compressor"]["output_tokens"] == 40 * story.compress_calls
