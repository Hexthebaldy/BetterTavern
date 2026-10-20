"""用假 LLM 服务把 M0 合规率评测完整跑一遍：流式导演、解析、OptionsRepair、统计。"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
import pytest

from bettertavern.providers.transport import EndpointPolicy, build_http_client
from evals.director_compliance import EVALS_ROOT, EvalConfig, TurnRecord, run_eval, summarize
from tests.fakes.llm_server import (
    JsonReply,
    RecordedRequest,
    Reply,
    RunningFakeLLM,
    StreamReply,
    completion,
    text_stream,
)

pytestmark = pytest.mark.anyio

COMPLIANT = (
    "<narrative>\n雨还在下，我听见门外有脚步声。\n</narrative>\n"
    "<options>\n1. 打开门看看\n2. 躲到柜台后面\n</options>"
)


class ScriptedDirector:
    """按导演请求的序号轮流制造各种输出：多数合规，少数缺标签、缺选项、带思考块。"""

    def __init__(self) -> None:
        self.director_calls = 0

    def __call__(self, request: RecordedRequest) -> Reply:
        body = request.body
        if not body.get("stream"):  # OptionsRepair 是非流式请求
            options = json.dumps({"options": ["追上去", "回到座位"]}, ensure_ascii=False)
            return JsonReply(completion(options))
        self.director_calls += 1
        n = self.director_calls
        if n % 10 == 3:
            text = COMPLIANT.replace("</narrative>\n", "")  # 叙述没闭合
        elif n % 10 == 7:
            text = "<narrative>\n我屏住呼吸。\n</narrative>"  # 没给选项 → OptionsRepair
        elif n % 10 == 9:
            text = "<think>想想怎么写</think>" + COMPLIANT
        else:
            text = COMPLIANT
        return self.reply(text)

    @staticmethod
    def reply(text: str) -> Reply:
        pieces = [text[i : i + 6] for i in range(0, len(text), 6)]
        usage = {"prompt_tokens": 900, "completion_tokens": 120, "prompt_cache_hit_tokens": 800}
        return StreamReply(text_stream(pieces, usage=usage))


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    async with build_http_client(EndpointPolicy(allow_private=True)) as http:
        yield http


async def test_offline_eval_counts_each_stage(
    client: httpx.AsyncClient, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.default_reply = ScriptedDirector()
    config = EvalConfig(
        provider="custom_openai",
        model="fake-model",
        api_key="sk-fake-0000000000",
        base_url=fake_llm.base_url,
        turns=20,
        history_turns=4,
    )
    seen: list[TurnRecord] = []
    report = await run_eval(config, client=client, on_turn=seen.append)
    summary = report["summary"]
    assert summary["turns"] == 20 == len(seen)
    assert summary["stages"] == {"ok": 16, "salvaged": 2, "repaired": 2}
    assert summary["compliance_no_repair"] == 0.8
    assert summary["compliance_with_repair"] == 1.0
    assert summary["verdict"].startswith("样本不足")
    assert summary["cache_hit_ratio"] == pytest.approx(800 / 900, abs=1e-4)
    # 报告里记下提示词版本，评测结果才能按版本对比
    assert report["prompt_versions"]["director.system"].isdigit()
    # 历史只带最近 4 轮，导演回合带上叙述和当时的选项（补出来的也算）
    last_director = [r for r in fake_llm.app.chat_requests if r.body.get("stream")][-1]
    messages = last_director.body["messages"]
    assert sum(1 for m in messages if m["role"] == "assistant") == 4
    assert all(m["content"].endswith("</options>") for m in messages if m["role"] == "assistant")
    assert messages[-1]["content"].startswith("<player-action>")


def test_summary_verdicts() -> None:
    ok = [TurnRecord(index=i, action="a", stage="ok") for i in range(200)]
    assert summarize(ok)["verdict"] == "go"
    mixed = [*ok[:189], *(TurnRecord(index=i, action="a", stage="salvaged") for i in range(11))]
    assert summarize(mixed)["verdict"] == "no-go"  # 无需修复 94.5% < 95%
    failed = [*ok[:199], TurnRecord(index=199, action="a", stage="failed", error="timeout: x")]
    summary = summarize(failed)
    assert summary["compliance_with_repair"] == 0.995
    assert summary["verdict"] == "go"
    assert summary["errors"] == {"timeout": 1}


async def test_japanese_scenario_uses_japanese_prompts(
    client: httpx.AsyncClient, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.default_reply = ScriptedDirector()
    config = EvalConfig(
        provider="custom_openai",
        model="fake-model",
        api_key="sk-fake-0000000000",
        base_url=fake_llm.base_url,
        turns=3,
        history_turns=2,
        scenario_path=EVALS_ROOT / "datasets" / "m0" / "ryokan_ja.yaml",
    )
    report = await run_eval(config, client=client)
    assert report["summary"]["turns"] == 3
    director = [r for r in fake_llm.app.chat_requests if r.body.get("stream")][-1]
    messages = director.body["messages"]
    assert messages[0]["content"].startswith("あなたは一人称で語られる")
    assert messages[-1]["content"].endswith("選択肢はちょうど2つにすること。）")
