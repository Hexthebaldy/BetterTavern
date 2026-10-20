from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from bettertavern.providers.base import ResolvedCredential, Secret
from bettertavern.providers.capabilities import load_rules, resolve_capabilities
from bettertavern.providers.openai_compat import OpenAICompatAdapter
from bettertavern.providers.probe import probe_model
from bettertavern.providers.profiles import CUSTOM_OPENAI, DEEPSEEK
from bettertavern.providers.transport import EndpointPolicy, build_http_client
from tests.fakes.llm_server import JsonReply, RunningFakeLLM, StreamReply, completion, text_stream

pytestmark = pytest.mark.anyio
RULES = load_rules()


@pytest.fixture
async def client() -> AsyncIterator[object]:
    async with build_http_client(EndpointPolicy(allow_private=True)) as http:
        yield http


def cred(fake: RunningFakeLLM, provider: str = "custom_openai") -> ResolvedCredential:
    return ResolvedCredential(
        "cred-1", provider, Secret("sk-test-abcdefgh"), base_url=fake.base_url
    )


async def test_probe_records_each_capability(client: object, fake_llm: RunningFakeLLM) -> None:
    unsupported = {"error": {"message": "response_format json_schema is not supported"}}
    tool_call = [
        {
            "id": "c1",
            "type": "function",
            "function": {"name": "report", "arguments": '{"ok": true}'},
        }
    ]
    fake_llm.app.push(
        StreamReply(text_stream(["OK"], usage={"prompt_tokens": 5, "completion_tokens": 1})),
        JsonReply(completion('{"ok": true}')),
        JsonReply(unsupported, status=400),
        JsonReply(completion("", tool_calls=tool_call, finish="tool_calls")),
    )
    adapter = OpenAICompatAdapter(CUSTOM_OPENAI, client)  # type: ignore[arg-type]
    caps = resolve_capabilities("custom_openai", "m", RULES)
    report = await probe_model(adapter, cred(fake_llm), "m", caps)
    results = {c.name: c.ok for c in report.checks}
    assert results == {
        "stream": True,
        "stream_usage": True,
        "json_object": True,
        "json_schema": False,
        "tool_call": True,
    }
    assert report.caps_overlay() == {
        "structured": ["tool_call", "json_object"],
        "tools": True,
        "stream_usage": True,
    }
    assert report.fatal_error is None
    final = resolve_capabilities("custom_openai", "m", RULES, probed=report.caps_overlay())
    assert final.structured_ladder() == ("tool_call", "json_object", "prompt_json")
    # 自定义端点默认不能调用工具，探测通过后才能用于后台整理
    assert final.tools is True


async def test_probe_stops_after_auth_failure(client: object, fake_llm: RunningFakeLLM) -> None:
    fake_llm.app.push(JsonReply({"error": {"message": "invalid api key"}}, status=401))
    adapter = OpenAICompatAdapter(CUSTOM_OPENAI, client)  # type: ignore[arg-type]
    report = await probe_model(
        adapter, cred(fake_llm), "m", resolve_capabilities("custom_openai", "m", RULES)
    )
    assert report.fatal_error is not None and report.fatal_error.startswith("auth")
    assert len(fake_llm.app.chat_requests) == 1
    assert [c.ok for c in report.checks if c.name != "stream"] == [None, None, None]
    assert report.caps_overlay() == {}


async def test_probe_retries_stream_without_stream_options(
    client: object, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(
        JsonReply(
            {"error": {"message": "Unrecognized request argument supplied: stream_options"}},
            status=400,
        ),
        StreamReply(text_stream(["OK"])),
        JsonReply(completion('{"ok": true}')),
        JsonReply(completion('{"ok": true}')),
        JsonReply(completion("no tool call")),
    )
    adapter = OpenAICompatAdapter(CUSTOM_OPENAI, client)  # type: ignore[arg-type]
    report = await probe_model(
        adapter, cred(fake_llm), "m", resolve_capabilities("custom_openai", "m", RULES)
    )
    assert report.check("stream").ok is True  # type: ignore[union-attr]
    assert report.caps_overlay()["stream_usage"] is False
    assert "stream_options" not in fake_llm.app.chat_requests[1].body


async def test_deepseek_probe_includes_reasoning_toggle(
    client: object, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(
        StreamReply(text_stream(["OK"], usage={"prompt_tokens": 5, "completion_tokens": 1})),
        JsonReply(completion('{"ok": true}')),
        JsonReply({"error": {"message": "json_schema not supported"}}, status=400),
        JsonReply({"error": {"message": "tool_choice is not supported"}}, status=400),
        JsonReply(completion("OK")),
    )
    adapter = OpenAICompatAdapter(DEEPSEEK, client)  # type: ignore[arg-type]
    caps = resolve_capabilities("deepseek", "deepseek-flash", RULES)
    report = await probe_model(adapter, cred(fake_llm, "deepseek"), "deepseek-flash", caps)
    assert report.check("reasoning_toggle").ok is True  # type: ignore[union-attr]
    # 探测时一律关闭思考
    assert all(r.body["thinking"] == {"type": "disabled"} for r in fake_llm.app.chat_requests)
    assert report.caps_overlay()["structured"] == ["json_object"]
