"""OpenAI、xAI（Grok）两家的 profile：请求体的改写、模型列表的过滤、能力表里的窗口和推理强度。"""

from __future__ import annotations

from bettertavern.providers.base import ChatRequest, Message, ReasoningConfig
from bettertavern.providers.capabilities import load_rules, resolve_capabilities
from bettertavern.providers.openai_compat import OpenAICompatAdapter
from bettertavern.providers.profiles import BUILTIN_PROFILES, OPENAI, XAI
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
        "huggingface",
        "custom_openai",
    ]
    registry = default_registry()
    assert registry.get("xai").display_name == "Grok"
    assert registry.get("openai").default_base_url == "https://api.openai.com/v1"
    assert registry.get("xai").default_base_url == "https://api.x.ai/v1"


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
