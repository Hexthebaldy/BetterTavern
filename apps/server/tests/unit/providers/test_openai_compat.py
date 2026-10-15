from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

import pytest

from bettertavern.providers.base import (
    ChatEvent,
    ChatRequest,
    Done,
    ForcedTool,
    Message,
    ReasoningConfig,
    ReasoningDelta,
    ResolvedCredential,
    ResponseFormat,
    Secret,
    TextDelta,
    ToolCallDelta,
    ToolSpec,
    Usage,
    UsageEvent,
)
from bettertavern.providers.cancel import CancelToken
from bettertavern.providers.capabilities import Capabilities, load_rules, resolve_capabilities
from bettertavern.providers.errors import ErrorClass, ProviderError
from bettertavern.providers.openai_compat import OpenAICompatAdapter, merge_extra_body, split_think
from bettertavern.providers.profiles import CUSTOM_OPENAI, DEEPSEEK, HUGGINGFACE
from bettertavern.providers.transport import EndpointPolicy, build_http_client
from tests.fakes.llm_server import (
    DONE,
    JsonReply,
    RunningFakeLLM,
    StreamReply,
    chunk,
    completion,
    sse,
    text_stream,
)

pytestmark = pytest.mark.anyio

RULES = load_rules()
DEEPSEEK_CAPS = resolve_capabilities("deepseek", "deepseek-flash", RULES)
GENERIC_CAPS = Capabilities()


def request(**kwargs: object) -> ChatRequest:
    defaults: dict[str, object] = {
        "messages": [Message(role="system", content="规则"), Message(role="user", content="推门")],
        "model": "deepseek-flash",
        "max_tokens": 256,
    }
    defaults.update(kwargs)
    return ChatRequest(**defaults)  # type: ignore[arg-type]


@pytest.fixture
async def adapter() -> AsyncIterator[OpenAICompatAdapter]:
    async with build_http_client(EndpointPolicy(allow_private=True)) as client:
        yield OpenAICompatAdapter(CUSTOM_OPENAI, client)


def cred(fake: RunningFakeLLM, **kwargs: object) -> ResolvedCredential:
    return ResolvedCredential(
        credential_id="cred-1",
        provider="custom_openai",
        api_key=Secret("sk-test-1234567890"),
        base_url=fake.base_url,
        **kwargs,  # type: ignore[arg-type]
    )


async def collect(stream: AsyncIterator[ChatEvent]) -> list[ChatEvent]:
    return [event async for event in stream]


# ---- 请求体 -------------------------------------------------------------------


def test_deepseek_body_thinking_disabled_keeps_temperature() -> None:
    adapter = OpenAICompatAdapter(DEEPSEEK, client=None)  # type: ignore[arg-type]
    body = adapter.build_body(
        request(temperature=0.9, reasoning=ReasoningConfig(enabled=False)),
        DEEPSEEK_CAPS,
        stream=True,
    )
    assert body["thinking"] == {"type": "disabled"}
    assert body["temperature"] == 0.9
    assert body["stream"] is True
    assert body["stream_options"] == {"include_usage": True}
    assert "reasoning_effort" not in body


def test_deepseek_body_thinking_enabled_drops_sampling_and_sets_effort() -> None:
    adapter = OpenAICompatAdapter(DEEPSEEK, client=None)  # type: ignore[arg-type]
    body = adapter.build_body(
        request(temperature=0.9, top_p=0.8, reasoning=ReasoningConfig(enabled=True, effort="high")),
        DEEPSEEK_CAPS,
        stream=False,
    )
    assert body["thinking"] == {"type": "enabled"}
    assert body["reasoning_effort"] == "high"
    assert "temperature" not in body and "top_p" not in body
    assert "stream" not in body


def test_deepseek_strips_empty_required_in_tools() -> None:
    adapter = OpenAICompatAdapter(DEEPSEEK, client=None)  # type: ignore[arg-type]
    tool = ToolSpec("noop", "nothing", {"type": "object", "properties": {}, "required": []})
    body = adapter.build_body(
        request(tools=[tool], tool_choice=ForcedTool("noop")), DEEPSEEK_CAPS, stream=False
    )
    assert "required" not in body["tools"][0]["function"]["parameters"]
    assert body["tool_choice"] == {"type": "function", "function": {"name": "noop"}}


def test_response_format_variants() -> None:
    adapter = OpenAICompatAdapter(CUSTOM_OPENAI, client=None)  # type: ignore[arg-type]
    body = adapter.build_body(
        request(response_format=ResponseFormat("json_object")), GENERIC_CAPS, stream=False
    )
    assert body["response_format"] == {"type": "json_object"}
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    body = adapter.build_body(
        request(response_format=ResponseFormat("json_schema", schema=schema, name="probe")),
        GENERIC_CAPS,
        stream=False,
    )
    assert body["response_format"]["json_schema"] == {
        "name": "probe",
        "schema": schema,
        "strict": True,
    }


def test_extra_body_merge_deletes_and_protects() -> None:
    adapter = OpenAICompatAdapter(CUSTOM_OPENAI, client=None)  # type: ignore[arg-type]
    body = adapter.build_body(
        request(temperature=0.7, extra_body={"temperature": None, "top_k": 40, "stream": False}),
        Capabilities(stream_usage=False),
        stream=True,
        cred_extra_body={"repetition_penalty": 1.1, "messages": []},
    )
    assert "temperature" not in body
    assert body["top_k"] == 40
    assert body["repetition_penalty"] == 1.1
    assert body["stream"] is True  # 受保护的键不会被覆盖
    assert body["messages"]  # 同上
    assert "stream_options" not in body


def test_merge_extra_body_is_deep() -> None:
    body = {"thinking": {"type": "disabled", "budget": 1}}
    merged = merge_extra_body(body, {"thinking": {"budget": None, "type": "enabled"}})
    assert merged == {"thinking": {"type": "enabled"}}


def test_reasoning_content_echo_only_with_tools_and_flag() -> None:
    adapter = OpenAICompatAdapter(DEEPSEEK, client=None)  # type: ignore[arg-type]
    history = [
        Message(role="user", content="q"),
        Message(role="assistant", content="a", reasoning_content="r"),
        Message(role="user", content="q2"),
    ]
    tool = ToolSpec("f", "d", {"type": "object", "properties": {"x": {"type": "string"}}})
    with_tools = adapter.build_body(
        request(messages=history, tools=[tool]), DEEPSEEK_CAPS, stream=False
    )
    without = adapter.build_body(request(messages=history), DEEPSEEK_CAPS, stream=False)
    assert with_tools["messages"][1]["reasoning_content"] == "r"
    assert "reasoning_content" not in without["messages"][1]


def test_split_think() -> None:
    assert split_think('<think>想一想</think>\n{"ok": true}') == ("想一想", '{"ok": true}')
    assert split_think("no think") == ("", "no think")


# ---- 流式 ---------------------------------------------------------------------


async def test_stream_happy_path(adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM) -> None:
    usage = {"prompt_tokens": 120, "completion_tokens": 9, "prompt_cache_hit_tokens": 100}
    fake_llm.app.push(
        StreamReply(
            [
                b": keep-alive\n\n",
                *text_stream(
                    ["<narrative>", "我推开门", "</narrative>"], usage=usage, reasoning=["想"]
                ),
            ]
        )
    )
    events = await collect(
        adapter.stream(
            request(),
            cred(fake_llm, extra_headers={"Authorization": "x", "X-Extra": "1"}),
            GENERIC_CAPS,
        )
    )
    assert events[0] == ReasoningDelta("想")
    assert [e.text for e in events if isinstance(e, TextDelta)] == [
        "<narrative>",
        "我推开门",
        "</narrative>",
    ]
    assert UsageEvent(Usage(prompt=120, completion=9, cached=100)) in events
    assert events[-1] == Done("stop")
    sent = fake_llm.app.chat_requests[-1]
    assert (
        sent.headers["authorization"] == "Bearer sk-test-1234567890"
    )  # extra_headers 不能覆盖鉴权
    assert sent.headers["x-extra"] == "1"
    assert sent.headers["accept"] == "text/event-stream"
    assert sent.body["stream"] is True


async def test_stream_multibyte_split_across_chunks(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    text = "雨夜的酒馆🌧️里，𠮷野家的人又来了。"
    raw = b"".join([sse(chunk(text)), sse(chunk(finish="stop")), DONE])
    fake_llm.app.push(StreamReply([raw[i : i + 3] for i in range(0, len(raw), 3)]))
    events = await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS))
    assert "".join(e.text for e in events if isinstance(e, TextDelta)) == text


async def test_stream_tool_call_deltas(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    calls = [{"index": 0, "id": "call_1", "function": {"name": "report", "arguments": '{"ok"'}}]
    more = [{"index": 0, "function": {"arguments": ": true}"}}]
    fake_llm.app.push(
        StreamReply(
            [
                sse(chunk(tool_calls=calls)),
                sse(chunk(tool_calls=more)),
                sse(chunk(finish="tool_calls")),
                DONE,
            ]
        )
    )
    events = await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS))
    deltas = [e for e in events if isinstance(e, ToolCallDelta)]
    assert deltas[0].name == "report" and deltas[0].id == "call_1"
    assert "".join(d.arguments for d in deltas) == '{"ok": true}'
    assert events[-1] == Done("tool_calls")


async def test_stream_http_error_is_classified(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(
        JsonReply(
            {"error": {"message": "Rate limit reached"}}, status=429, headers={"Retry-After": "2"}
        )
    )
    with pytest.raises(ProviderError) as info:
        await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS))
    assert info.value.error_class is ErrorClass.RATE_LIMIT
    assert info.value.retry_after == 2.0
    assert not info.value.partial


async def test_stream_error_chunk_mid_stream(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(
        StreamReply([sse(chunk("开头")), sse({"error": {"message": "upstream overloaded"}})])
    )
    seen: list[ChatEvent] = []
    with pytest.raises(ProviderError) as info:
        async for event in adapter.stream(request(), cred(fake_llm), GENERIC_CAPS):
            seen.append(event)
    assert seen == [TextDelta("开头")]
    assert info.value.error_class is ErrorClass.OVERLOADED
    assert info.value.partial


async def test_stream_disconnect_is_interrupted_and_partial(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(StreamReply([sse(chunk("半截")), 0.05], disconnect=True))
    with pytest.raises(ProviderError) as info:
        await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS))
    assert info.value.error_class is ErrorClass.STREAM_INTERRUPTED
    assert info.value.partial


async def test_stream_end_without_done_marker_but_with_finish_reason(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(StreamReply(text_stream(["好"], done=False)))
    events = await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS))
    assert events[-1] == Done("stop")


async def test_stream_end_without_any_terminator_is_interrupted(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(StreamReply([sse(chunk("好"))]))
    with pytest.raises(ProviderError) as info:
        await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS))
    assert info.value.error_class is ErrorClass.STREAM_INTERRUPTED


async def test_backend_ignoring_stream_flag(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(
        JsonReply(completion("整段返回", usage={"prompt_tokens": 3, "completion_tokens": 2}))
    )
    events = await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS))
    assert TextDelta("整段返回") in events
    assert events[-1] == Done("stop")


async def test_sse_line_limit(fake_llm: RunningFakeLLM) -> None:
    async with build_http_client(EndpointPolicy(allow_private=True)) as client:
        small = OpenAICompatAdapter(CUSTOM_OPENAI, client, max_sse_line_bytes=64)
        fake_llm.app.push(StreamReply([b"data: " + b"x" * 200]))
        with pytest.raises(ProviderError) as info:
            await collect(small.stream(request(), cred(fake_llm), GENERIC_CAPS))
    assert info.value.error_class is ErrorClass.INVALID_RESPONSE


async def test_cancel_mid_stream_closes_quickly(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(StreamReply([sse(chunk("第一句")), 5.0, sse(chunk("不会到达")), DONE]))
    token = CancelToken()
    seen: list[ChatEvent] = []

    async def consume() -> None:
        async for event in adapter.stream(request(), cred(fake_llm), GENERIC_CAPS, cancel=token):
            seen.append(event)
            token.cancel("player")

    with pytest.raises(ProviderError) as info:
        await asyncio.wait_for(consume(), timeout=2.0)
    assert info.value.error_class is ErrorClass.CANCELLED
    assert info.value.partial
    assert seen == [TextDelta("第一句")]


async def test_cancel_while_waiting_for_headers(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(StreamReply(text_stream(["迟到"]), headers_delay=3.0))
    token = CancelToken()
    loop = asyncio.get_running_loop()
    loop.call_later(0.2, token.cancel, "player")
    started = loop.time()
    with pytest.raises(ProviderError) as info:
        await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS, cancel=token))
    assert info.value.error_class is ErrorClass.CANCELLED
    assert loop.time() - started < 1.0  # 不用等上游的响应头


async def test_already_cancelled_token_sends_nothing(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    token = CancelToken()
    token.cancel()
    with pytest.raises(ProviderError) as info:
        await collect(adapter.stream(request(), cred(fake_llm), GENERIC_CAPS, cancel=token))
    assert info.value.error_class is ErrorClass.CANCELLED
    assert fake_llm.app.requests == []


# ---- 非流式与模型列表 ---------------------------------------------------------


async def test_complete_parses_reasoning_and_think_tags(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(JsonReply(completion('<think>先想</think>{"ok": true}')))
    result = await adapter.complete(request(), cred(fake_llm), GENERIC_CAPS)
    assert result.text == '{"ok": true}'
    assert result.reasoning == "先想"
    assert result.usage == Usage(prompt=10, completion=5)
    assert "stream" not in fake_llm.app.chat_requests[-1].body


async def test_complete_tool_calls(adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM) -> None:
    calls = [
        {
            "id": "c1",
            "type": "function",
            "function": {"name": "report", "arguments": '{"ok": true}'},
        }
    ]
    fake_llm.app.push(JsonReply(completion("", tool_calls=calls, finish="tool_calls")))
    result = await adapter.complete(request(), cred(fake_llm), GENERIC_CAPS)
    assert result.tool_calls[0].name == "report"
    assert result.finish_reason == "tool_calls"


async def test_complete_error_body_with_200_status(
    adapter: OpenAICompatAdapter, fake_llm: RunningFakeLLM
) -> None:
    fake_llm.app.push(
        JsonReply({"error": {"message": "This model's maximum context length is 8192"}})
    )
    with pytest.raises(ProviderError) as info:
        await adapter.complete(request(), cred(fake_llm), GENERIC_CAPS)
    assert info.value.error_class is ErrorClass.CONTEXT_OVERFLOW


async def test_complete_total_timeout(fake_llm: RunningFakeLLM) -> None:
    async with build_http_client(EndpointPolicy(allow_private=True)) as client:
        slow = OpenAICompatAdapter(CUSTOM_OPENAI, client, total_timeout=0.2)
        fake_llm.app.push(
            StreamReply(
                [1.0, json.dumps(completion("late")).encode()], content_type="application/json"
            )
        )
        with pytest.raises(ProviderError) as info:
            await slow.complete(request(), cred(fake_llm), GENERIC_CAPS)
    assert info.value.error_class is ErrorClass.TIMEOUT


async def test_list_models_hugging_face_windows(fake_llm: RunningFakeLLM) -> None:
    fake_llm.app.models = [
        {
            "id": "b-model",
            "providers": [{"provider": "x", "context_length": 32768}, {"context_length": 8192}],
        },
        {"id": "a-model", "context_length": 131072},
        {"object": "model"},
    ]
    async with build_http_client(EndpointPolicy(allow_private=True)) as client:
        hf = OpenAICompatAdapter(HUGGINGFACE, client)
        models = await hf.list_models(cred(fake_llm))
    assert [(m.id, m.context_window) for m in models] == [("a-model", 131072), ("b-model", 8192)]
    # 指定了后端就用那一家的窗口；策略后缀或不带后缀可能分到任何一家，取最小的
    assert HUGGINGFACE.window_of(models, "b-model:x") == 32768
    assert HUGGINGFACE.window_of(models, "b-model:fastest") == 8192
    assert HUGGINGFACE.window_of(models, "b-model") == 8192
    assert HUGGINGFACE.window_of(models, "b-model:unknown-backend") == 8192
    assert HUGGINGFACE.window_of(models, "c-model") is None


async def test_list_models_reads_vllm_window(fake_llm: RunningFakeLLM) -> None:
    fake_llm.app.models = [{"id": "local", "max_model_len": 16384}, {"id": "other"}]
    async with build_http_client(EndpointPolicy(allow_private=True)) as client:
        adapter = OpenAICompatAdapter(CUSTOM_OPENAI, client)
        models = await adapter.list_models(cred(fake_llm))
    assert CUSTOM_OPENAI.window_of(models, "local") == 16384
    assert CUSTOM_OPENAI.window_of(models, "other") is None


async def test_custom_endpoint_requires_base_url() -> None:
    adapter = OpenAICompatAdapter(CUSTOM_OPENAI, client=None)  # type: ignore[arg-type]
    no_url = ResolvedCredential(credential_id="c", provider="custom_openai", api_key=Secret("k"))
    with pytest.raises(ProviderError) as info:
        await adapter.complete(request(), no_url, GENERIC_CAPS)
    assert info.value.error_class is ErrorClass.ENDPOINT_NOT_ALLOWED
