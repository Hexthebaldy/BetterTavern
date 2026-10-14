"""结构化输出阶梯：按能力选级、校验失败带错误重试、降级与负缓存。"""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from bettertavern.providers import (
    Capabilities,
    ChatResult,
    Message,
    NegativeCapabilityCache,
    ProviderError,
    ToolCall,
    Usage,
)
from bettertavern.providers.capabilities import StructuredMode
from bettertavern.providers.errors import ErrorClass
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.structured import StructuredOutputError, run_structured
from tests.fakes.runtime import result, scripted_hub

pytestmark = pytest.mark.anyio


class Answer(BaseModel):
    value: int


def builder(seen: list[StructuredMode]) -> object:
    def build(mode: StructuredMode) -> list[Message]:
        seen.append(mode)
        return [Message(role="user", content=f"mode={mode}")]

    return build


async def call(
    adapter: object, caps: Capabilities, cache: NegativeCapabilityCache, seen: list[StructuredMode]
) -> object:
    from tests.fakes.runtime import make_route

    route = make_route(caps=caps)
    return await run_structured(
        adapter,  # type: ignore[arg-type]
        route.credential,
        caps,
        model="fake-model",
        output=Answer,
        name="answer",
        description="测试",
        build_messages=builder(seen),  # type: ignore[arg-type]
        prompts=PromptLibrary("zh"),
        max_tokens=100,
        temperature=None,
        reasoning=None,
        negative_cache=cache,
    )


async def test_prompt_json_with_retry_after_validation_error() -> None:
    _, adapters = scripted_hub("fake")
    adapter = adapters["fake"]
    adapter.completions.extend(
        [result('{"value": "很多"}'), result('好的：```json\n{"value": 3}\n```')]
    )
    seen: list[StructuredMode] = []
    out = await call(adapter, Capabilities(), NegativeCapabilityCache(), seen)
    assert out.value.value == 3 and out.attempts == 2 and out.mode == "prompt_json"  # type: ignore[attr-defined]
    retry = adapter.requests[-1].messages
    assert retry[-2].role == "assistant" and "上一次的输出没有通过校验" in retry[-1].content
    assert out.usage == Usage(prompt=20, completion=10)  # type: ignore[attr-defined]


async def test_unsupported_level_is_skipped_and_cached() -> None:
    _, adapters = scripted_hub("fake")
    adapter = adapters["fake"]
    adapter.completions.extend(
        [
            ProviderError(ErrorClass.UNSUPPORTED_FEATURE, "json_schema not supported"),
            ChatResult(
                text="",
                reasoning="",
                tool_calls=(ToolCall(id="c1", name="answer", arguments='{"value": 7}'),),
                finish_reason="tool_calls",
                usage=None,
            ),
        ]
    )
    cache = NegativeCapabilityCache()
    seen: list[StructuredMode] = []
    caps = Capabilities(structured=("json_schema", "tool_call"))
    out = await call(adapter, caps, cache, seen)
    assert out.value.value == 7 and out.mode == "tool_call"  # type: ignore[attr-defined]
    assert seen == ["json_schema", "tool_call"]
    assert cache.disabled("cred-fake", "fake-model") == {"json_schema"}
    assert adapter.requests[0].response_format is not None
    assert adapter.requests[1].tools is not None


async def test_gives_up_after_two_levels() -> None:
    _, adapters = scripted_hub("fake")
    adapter = adapters["fake"]
    adapter.completions.extend([result("x"), result("y"), result("z")])
    cache = NegativeCapabilityCache()
    seen: list[StructuredMode] = []
    with pytest.raises(StructuredOutputError) as info:
        await call(adapter, Capabilities(structured=("json_object",)), cache, seen)
    assert info.value.attempts == 3
    assert seen == ["json_object", "prompt_json"]
    assert cache.disabled("cred-fake", "fake-model") == {"json_object"}


async def test_transport_errors_propagate() -> None:
    _, adapters = scripted_hub("fake")
    adapters["fake"].completions.append(ProviderError(ErrorClass.AUTH, "bad key"))
    with pytest.raises(ProviderError):
        await call(adapters["fake"], Capabilities(), NegativeCapabilityCache(), [])
