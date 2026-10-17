from __future__ import annotations

import pytest

from bettertavern.providers.capabilities import (
    Capabilities,
    NegativeCapabilityCache,
    load_rules,
    parse_rules,
    resolve_capabilities,
)

RULES = parse_rules(
    [
        {"match": {}, "caps": {"context_window": 32768, "max_output": 4096}},
        {"match": {"model": "llama-*"}, "caps": {"context_window": 65536}},
        {"match": {"provider": "acme"}, "caps": {"structured": ["json_object"]}},
        {
            "match": {"provider": "acme", "model": "llama-3.1-*"},
            "caps": {"context_window": 131072, "reasoning": {"control": "effort"}},
        },
    ]
)


def test_more_specific_rules_win() -> None:
    caps = resolve_capabilities("acme", "llama-3.1-8b", RULES)
    assert caps.context_window == 131072
    assert caps.max_output == 4096
    assert caps.structured == ("json_object",)
    assert caps.reasoning.control == "effort"
    other = resolve_capabilities("other", "llama-2", RULES)
    assert other.context_window == 65536
    assert other.structured == ()


def test_probe_then_override_layering() -> None:
    caps = resolve_capabilities(
        "acme",
        "llama-3.1-8b",
        RULES,
        probed={"structured": ["json_schema", "json_object"], "stream_usage": False},
        override={"context_window": 50000},
    )
    assert caps.structured == ("json_schema", "json_object")
    assert caps.stream_usage is False
    assert caps.context_window == 50000


def test_structured_ladder_order_and_negative_cache() -> None:
    caps = Capabilities(structured=("json_object", "json_schema", "tool_call"))
    assert caps.structured_ladder() == ("json_schema", "tool_call", "json_object", "prompt_json")
    assert caps.structured_ladder({"json_schema"}) == ("tool_call", "json_object", "prompt_json")
    assert Capabilities().structured_ladder() == ("prompt_json",)


def test_unknown_keys_are_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown fields"):
        parse_rules([{"match": {}, "caps": {"context_windw": 1}}])
    with pytest.raises(ValueError):
        parse_rules([{"match": {}, "caps": {"structured": ["xml"]}}])
    with pytest.raises(ValueError):
        parse_rules([{"match": {"vendor": "x"}, "caps": {}}])


def test_builtin_rules_load_and_cover_v1_providers() -> None:
    rules = load_rules()
    deepseek = resolve_capabilities("deepseek", "deepseek-flash", rules)
    assert deepseek.context_window == 1_000_000
    assert deepseek.reasoning.control == "thinking_toggle"
    assert deepseek.structured == ("json_object",)
    assert deepseek.sampling.temperature_when_thinking is False
    hf = resolve_capabilities("huggingface", "deepseek-ai/DeepSeek-V3:fastest", rules)
    assert hf.structured == ()  # HF 上的 deepseek 模型不能套用 DeepSeek 官方的能力
    assert hf.reasoning.control == "none"
    custom = resolve_capabilities("custom_openai", "qwen2.5", rules)
    # 没有规则知道窗口时不编一个数，由路由按 32K 估计并标明是估计值
    assert custom.context_window is None


def test_negative_cache_expires() -> None:
    now = [0.0]
    cache = NegativeCapabilityCache(ttl_seconds=60, clock=lambda: now[0])
    cache.add("cred", "m", "json_schema")
    assert cache.disabled("cred", "m") == {"json_schema"}
    assert cache.disabled("cred", "other") == frozenset()
    now[0] = 61
    assert cache.disabled("cred", "m") == frozenset()
