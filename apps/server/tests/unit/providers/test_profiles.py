"""OpenAI、xAI（Grok）、Gemini 的 profile：请求体的改写、模型列表的过滤、
能力表里的窗口和推理强度。"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from bettertavern.domain.world.seed import Seed
from bettertavern.providers.base import (
    ChatRequest,
    ForcedTool,
    Message,
    ReasoningConfig,
    ResponseFormat,
    ToolSpec,
)
from bettertavern.providers.capabilities import load_rules, resolve_capabilities
from bettertavern.providers.openai_compat import OpenAICompatAdapter
from bettertavern.providers.profiles import BUILTIN_PROFILES, GEMINI, OPENAI, XAI
from bettertavern.providers.profiles.gemini import inline_refs
from bettertavern.providers.registry import default_registry

RULES = load_rules()


def request(model: str, **kwargs: object) -> ChatRequest:
    defaults: dict[str, object] = {
        "messages": [Message(role="system", content="规则"), Message(role="user", content="推门")],
        "model": model,
        "max_tokens": 256,
    }
    defaults.update(kwargs)
    return ChatRequest(**defaults)  # type: ignore[arg-type]


def listed(profile: object, ids: list[str]) -> list[str]:
    parse = profile.parse_model  # type: ignore[attr-defined]
    return [info.id for info in (parse({"id": i, "object": "model"}) for i in ids) if info]


def test_registry_order_matches_the_provider_tiles() -> None:
    assert [p.id for p in BUILTIN_PROFILES] == [
        "deepseek",
        "openai",
        "xai",
        "gemini",
        "huggingface",
        "custom_openai",
    ]
    registry = default_registry()
    assert registry.get("xai").display_name == "Grok"
    assert registry.get("openai").default_base_url == "https://api.openai.com/v1"
    assert registry.get("xai").default_base_url == "https://api.x.ai/v1"
    assert registry.get("gemini").display_name == "Gemini"
    assert (
        registry.get("gemini").default_base_url
        == "https://generativelanguage.googleapis.com/v1beta/openai"
    )


# ---- OpenAI ----------------------------------------------------------------------------


def test_openai_sends_max_completion_tokens() -> None:
    adapter = OpenAICompatAdapter(OPENAI, client=None)  # type: ignore[arg-type]
    caps = resolve_capabilities("openai", "gpt-5.5", RULES)
    body = adapter.build_body(request("gpt-5.5"), caps, stream=False)
    assert body["max_completion_tokens"] == 256
    assert "max_tokens" not in body


def test_openai_reasoning_drops_sampling_unless_turned_off() -> None:
    adapter = OpenAICompatAdapter(OPENAI, client=None)  # type: ignore[arg-type]
    caps = resolve_capabilities("openai", "gpt-5.5", RULES)
    on = adapter.build_body(
        request("gpt-5.5", temperature=0.8, top_p=0.9, reasoning=ReasoningConfig(enabled=True)),
        caps,
        stream=False,
    )
    assert "temperature" not in on and "top_p" not in on and "reasoning_effort" not in on
    off = adapter.build_body(
        request("gpt-5.5", temperature=0.8, reasoning=ReasoningConfig(enabled=False)),
        caps,
        stream=False,
    )
    assert off["reasoning_effort"] == "none" and off["temperature"] == 0.8
    # 推理关不掉的模型：关了也不发 none，温度照样去掉
    astra = resolve_capabilities("openai", "gpt-6-astra", RULES)
    body = adapter.build_body(
        request("gpt-6-astra", temperature=0.8, reasoning=ReasoningConfig(enabled=False)),
        astra,
        stream=False,
    )
    assert "reasoning_effort" not in body and "temperature" not in body
    # 非推理模型不动
    gpt4o = resolve_capabilities("openai", "gpt-4o", RULES)
    body = adapter.build_body(request("gpt-4o", temperature=0.8), gpt4o, stream=False)
    assert body["temperature"] == 0.8 and "reasoning_effort" not in body


def test_openai_windows_from_the_table() -> None:
    def window(model: str) -> int | None:
        return resolve_capabilities("openai", model, RULES).context_window

    assert window("gpt-6-sol") == 1_050_000
    assert window("gpt-5.5") == 1_050_000
    assert window("gpt-5.4-mini") == 400_000
    assert window("gpt-5-mini") == 400_000
    assert window("gpt-5.2-2025-12-11") == 400_000
    assert window("o3") == 200_000
    assert window("gpt-4o") == 128_000
    efforts = resolve_capabilities("openai", "gpt-6-astra", RULES).reasoning.efforts
    assert "none" not in efforts and "max" in efforts


def test_openai_lists_only_chat_models() -> None:
    ids = [
        "gpt-5.5",
        "gpt-5.5-mini",
        "o4-mini",
        "chatgpt-4o-latest",
        "text-embedding-3-large",
        "gpt-4o-mini-tts",
        "gpt-4o-transcribe",
        "gpt-realtime",
        "gpt-image-1",
        "dall-e-3",
        "whisper-1",
        "omni-moderation-latest",
        "gpt-3.5-turbo-instruct",
        "davinci-002",
        "gpt-5.5-pro",
        "o3-pro",
    ]
    assert listed(OPENAI, ids) == ["gpt-5.5", "gpt-5.5-mini", "o4-mini", "chatgpt-4o-latest"]


# ---- xAI（Grok） -------------------------------------------------------------------------


def test_xai_reasoning_models_drop_rejected_fields() -> None:
    adapter = OpenAICompatAdapter(XAI, client=None)  # type: ignore[arg-type]
    caps = resolve_capabilities("xai", "grok-4.7", RULES)
    body = adapter.build_body(
        request("grok-4.7", stop=["\n\n"], reasoning=ReasoningConfig(enabled=True, effort="xhigh")),
        caps,
        stream=False,
    )
    assert "stop" not in body
    assert body["reasoning_effort"] == "xhigh"
    assert body["max_tokens"] == 256

    plain = resolve_capabilities("xai", "grok-4.20-0309-non-reasoning", RULES)
    body = adapter.build_body(
        request("grok-4.20-0309-non-reasoning", stop=["\n\n"]), plain, stream=False
    )
    assert body["stop"] == ["\n\n"]


def test_xai_effort_only_where_documented() -> None:
    adapter = OpenAICompatAdapter(XAI, client=None)  # type: ignore[arg-type]
    caps = resolve_capabilities("xai", "grok-4.3", RULES)
    body = adapter.build_body(
        request("grok-4.3", reasoning=ReasoningConfig(enabled=True, effort="high")),
        caps,
        stream=False,
    )
    assert "reasoning_effort" not in body
    # 4.5 不认 xhigh：能力表里没有它，就不发
    caps45 = resolve_capabilities("xai", "grok-4.5", RULES)
    body = adapter.build_body(
        request("grok-4.5", reasoning=ReasoningConfig(enabled=True, effort="xhigh")),
        caps45,
        stream=False,
    )
    assert "reasoning_effort" not in body


def test_xai_lists_only_chat_models() -> None:
    ids = [
        "grok-4.7",
        "grok-4.20-0309-reasoning",
        "grok-build-0.1",
        "grok-4.20-multi-agent-0309",
        "grok-imagine-image",
        "grok-imagine-video-1.5",
        "grok-voice-3.0",
    ]
    assert listed(XAI, ids) == ["grok-4.7", "grok-4.20-0309-reasoning", "grok-build-0.1"]


def test_xai_windows_from_the_table() -> None:
    assert resolve_capabilities("xai", "grok-4.7", RULES).context_window == 500_000
    assert resolve_capabilities("xai", "grok-4.3", RULES).context_window == 1_000_000
    assert (
        resolve_capabilities("xai", "grok-4.20-0309-reasoning", RULES).context_window == 1_000_000
    )
    assert resolve_capabilities("xai", "grok-build-0.1", RULES).context_window == 256_000
    assert resolve_capabilities("xai", "grok-4.7", RULES).structured == ("json_schema",)


# ---- Gemini ----------------------------------------------------------------------------


def gemini_body(model: str, **kwargs: Any) -> dict[str, Any]:
    adapter = OpenAICompatAdapter(GEMINI, client=None)  # type: ignore[arg-type]
    caps = resolve_capabilities("gemini", model, RULES)
    return adapter.build_body(request(model, **kwargs), caps, stream=False)


def test_gemini_thinking_off_sends_the_lowest_level_with_headroom() -> None:
    # 3.8 Flash 关不掉思考、不认 minimal：发 low，输出上限加上思考余量
    body = gemini_body("gemini-3.8-flash", reasoning=ReasoningConfig(enabled=False))
    assert body["reasoning_effort"] == "low"
    assert body["max_tokens"] == 256 + 2048
    # 3.6 Flash 认 minimal
    body = gemini_body("gemini-3.6-flash", reasoning=ReasoningConfig(enabled=False))
    assert body["reasoning_effort"] == "minimal"
    # 2.5 Flash 能关：发 none，不加余量
    body = gemini_body("gemini-2.5-flash", reasoning=ReasoningConfig(enabled=False))
    assert body["reasoning_effort"] == "none"
    assert body["max_tokens"] == 256
    # 2.5 Pro 关不掉
    body = gemini_body("gemini-2.5-pro", reasoning=ReasoningConfig(enabled=False))
    assert body["reasoning_effort"] == "low"


def test_gemini_thinking_on_uses_the_model_default_with_more_headroom() -> None:
    body = gemini_body("gemini-4-argon", reasoning=ReasoningConfig(enabled=True))
    assert "reasoning_effort" not in body
    assert body["max_tokens"] == 256 + 16384
    # 余量加上去也不超过模型的输出上限
    body = gemini_body("gemini-4-argon", max_tokens=60000, reasoning=ReasoningConfig(enabled=True))
    assert body["max_tokens"] == 65536
    # 指定了这个模型认的档就照发
    body = gemini_body("gemini-4-argon", reasoning=ReasoningConfig(enabled=True, effort="high"))
    assert body["reasoning_effort"] == "high"


def test_gemini_drops_sampling_only_on_models_that_ignore_it() -> None:
    for model in ("gemini-4-argon", "gemini-3.8-flash", "gemini-3.6-flash"):
        body = gemini_body(model, temperature=0.9, top_p=0.95)
        assert "temperature" not in body and "top_p" not in body, model
    for model in ("gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-2.5-flash"):
        body = gemini_body(model, temperature=0.9, top_p=0.95)
        assert body["temperature"] == 0.9 and body["top_p"] == 0.95, model


def _has_ref(value: Any) -> bool:
    return "$ref" in json.dumps(value) or "$defs" in json.dumps(value)


class _Place(BaseModel):
    name: str


class _Story(BaseModel):
    home: _Place = Field(description="where it starts")
    places: list[_Place] = []


def test_gemini_inlines_schema_refs() -> None:
    schema = _Story.model_json_schema()
    assert _has_ref(schema)
    flat = inline_refs(schema)
    assert not _has_ref(flat)
    # 和 $ref 写在一起的字段说明保留下来
    assert flat["properties"]["home"]["description"] == "where it starts"
    assert flat["properties"]["home"]["properties"]["name"]["type"] == "string"
    assert flat["properties"]["places"]["items"]["properties"]["name"]["type"] == "string"
    # 开局用的 Seed 整个展开得开
    assert not _has_ref(inline_refs(Seed.model_json_schema()))
    # 自引用展开不完：原样返回
    loop = {
        "$defs": {"Node": {"type": "object", "properties": {"next": {"$ref": "#/$defs/Node"}}}},
        "$ref": "#/$defs/Node",
    }
    assert inline_refs(loop) == loop


def test_gemini_request_schemas_are_inlined() -> None:
    schema = _Story.model_json_schema()
    body = gemini_body(
        "gemini-3.8-flash",
        response_format=ResponseFormat(type="json_schema", schema=schema, name="story"),
    )
    assert not _has_ref(body["response_format"])
    body = gemini_body(
        "gemini-3.8-flash",
        tools=[ToolSpec(name="story", description="", parameters=schema)],
        tool_choice=ForcedTool("story"),
    )
    assert not _has_ref(body["tools"])
    # 原来的 schema 没被改动
    assert _has_ref(schema)


def test_gemini_lists_only_chat_models() -> None:
    ids = [
        "models/gemini-4-argon",
        "gemini-3.8-flash",
        "models/gemini-3.1-pro-preview",
        "gemini-flash-latest",
        "models/gemini-3.1-pro-preview-customtools",
        "models/gemini-3.1-flash-lite-image",
        "models/gemini-embedding-001",
        "models/gemini-2.5-flash-preview-tts",
        "models/gemini-live-2.5-flash",
        "models/gemini-2.5-flash-native-audio",
        "models/gemini-robotics-er-2-preview",
        "models/gemini-2.5-computer-use-preview-10-2025",
        "models/imagen-4.0-generate-001",
        "models/veo-3.0-generate-001",
        "models/gemma-3-27b-it",
    ]
    assert listed(GEMINI, ids) == [
        "gemini-4-argon",
        "gemini-3.8-flash",
        "gemini-3.1-pro-preview",
        "gemini-flash-latest",
    ]


def test_gemini_windows_from_the_table() -> None:
    caps = resolve_capabilities("gemini", "gemini-3.8-flash", RULES)
    assert caps.context_window == 1_048_576
    assert caps.max_output == 65_536
    assert caps.structured == ("json_schema",)
    assert caps.reasoning.efforts == ("low", "medium", "high")
    assert resolve_capabilities("gemini", "gemini-3-flash-preview", RULES).reasoning.efforts[0] == (
        "minimal"
    )
    # 列表里出现的别名（gemini-flash-latest）不知道是哪个模型：用整家都认的档
    latest = resolve_capabilities("gemini", "gemini-flash-latest", RULES)
    assert latest.reasoning.efforts == ("low", "medium", "high")
    assert latest.sampling.temperature
