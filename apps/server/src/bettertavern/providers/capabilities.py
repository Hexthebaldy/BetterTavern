"""能力表：不靠型号正则猜，而是四层叠加。

优先级从高到低：路由的 caps_override > 探测结果 > capabilities.yaml 里最具体的规则 > 保守默认值。
"""

from __future__ import annotations

import fnmatch
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast

import yaml

StructuredMode = Literal["json_schema", "tool_call", "json_object", "prompt_json"]
_CONFIRMABLE: tuple[StructuredMode, ...] = ("json_schema", "tool_call", "json_object")

DEFAULT_RULES_PATH = Path(__file__).with_name("capabilities.yaml")


@dataclass(frozen=True, slots=True)
class ReasoningCaps:
    control: Literal["none", "thinking_toggle", "effort"] = "none"
    efforts: tuple[str, ...] = ()
    field: str | None = None


@dataclass(frozen=True, slots=True)
class SamplingCaps:
    temperature: bool = True
    top_p: bool = True
    temperature_when_thinking: bool = True


@dataclass(frozen=True, slots=True)
class RoleCaps:
    system: bool = True
    alternation: Literal["loose", "strict"] = "loose"


@dataclass(frozen=True, slots=True)
class Capabilities:
    context_window: int | None = None
    max_output: int | None = None
    # 已确认可用的结构化输出方式；prompt_json 总是可用，不列在这里
    structured: tuple[StructuredMode, ...] = ()
    reasoning: ReasoningCaps = field(default_factory=ReasoningCaps)
    sampling: SamplingCaps = field(default_factory=SamplingCaps)
    roles: RoleCaps = field(default_factory=RoleCaps)
    stream_usage: bool = True
    echo_reasoning_with_tools: bool = False

    def structured_ladder(self, disabled: Iterable[str] = ()) -> tuple[StructuredMode, ...]:
        """按 json_schema → tool_call → json_object → prompt_json 的顺序列出可用的方式。"""
        blocked = set(disabled)
        modes: list[StructuredMode] = [
            m for m in _CONFIRMABLE if m in self.structured and m not in blocked
        ]
        modes.append("prompt_json")
        return tuple(modes)

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> Capabilities:
        _check_keys(data, _TOP_KEYS, "caps")
        reasoning = data.get("reasoning") or {}
        sampling = data.get("sampling") or {}
        roles = data.get("roles") or {}
        _check_keys(reasoning, {"control", "efforts", "field"}, "caps.reasoning")
        _check_keys(
            sampling, {"temperature", "top_p", "temperature_when_thinking"}, "caps.sampling"
        )
        _check_keys(roles, {"system", "alternation"}, "caps.roles")
        structured = tuple(data.get("structured") or ())
        unknown = [m for m in structured if m not in _CONFIRMABLE]
        if unknown:
            raise ValueError(f"Unknown modes in caps.structured: {unknown}")
        control = reasoning.get("control", "none")
        if control not in ("none", "thinking_toggle", "effort"):
            raise ValueError(f"Invalid caps.reasoning.control: {control!r}")
        alternation = roles.get("alternation", "loose")
        if alternation not in ("loose", "strict"):
            raise ValueError(f"Invalid caps.roles.alternation: {alternation!r}")
        return cls(
            context_window=_opt_int(data.get("context_window"), "context_window"),
            max_output=_opt_int(data.get("max_output"), "max_output"),
            structured=cast(tuple[StructuredMode, ...], structured),
            reasoning=ReasoningCaps(
                control=control,
                efforts=tuple(str(e) for e in reasoning.get("efforts") or ()),
                field=reasoning.get("field"),
            ),
            sampling=SamplingCaps(
                temperature=bool(sampling.get("temperature", True)),
                top_p=bool(sampling.get("top_p", True)),
                temperature_when_thinking=bool(sampling.get("temperature_when_thinking", True)),
            ),
            roles=RoleCaps(system=bool(roles.get("system", True)), alternation=alternation),
            stream_usage=bool(data.get("stream_usage", True)),
            echo_reasoning_with_tools=bool(data.get("echo_reasoning_with_tools", False)),
        )


_TOP_KEYS = {
    "context_window",
    "max_output",
    "structured",
    "reasoning",
    "sampling",
    "roles",
    "stream_usage",
    "echo_reasoning_with_tools",
}


def _check_keys(data: Mapping[str, Any], allowed: set[str], where: str) -> None:
    if not isinstance(data, Mapping):
        raise ValueError(f"{where} must be a mapping")
    extra = set(data) - allowed
    if extra:
        raise ValueError(f"Unknown fields in {where}: {sorted(extra)}")


def _opt_int(value: Any, name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"caps.{name} must be a positive integer")
    return value


def deep_merge(base: Mapping[str, Any], over: Mapping[str, Any]) -> dict[str, Any]:
    """映射递归合并；列表和标量整体替换。"""
    merged = dict(base)
    for key, value in over.items():
        current = merged.get(key)
        if isinstance(current, Mapping) and isinstance(value, Mapping):
            merged[key] = deep_merge(current, value)
        else:
            merged[key] = value
    return merged


@dataclass(frozen=True, slots=True)
class CapabilityRule:
    provider: str | None
    model: str | None  # fnmatch 通配，不区分大小写
    caps: Mapping[str, Any]
    order: int

    def matches(self, provider: str, model: str) -> bool:
        if self.provider is not None and self.provider != provider:
            return False
        return self.model is None or fnmatch.fnmatchcase(model.lower(), self.model.lower())

    @property
    def specificity(self) -> tuple[int, int, int]:
        literal = 0 if self.model is None else sum(1 for ch in self.model if ch not in "*?[]")
        return (1 if self.provider else 0, literal, self.order)


def parse_rules(data: Any) -> list[CapabilityRule]:
    if not isinstance(data, list):
        raise ValueError("capabilities.yaml must be a list of rules at the top level")
    rules: list[CapabilityRule] = []
    for index, item in enumerate(data):
        if not isinstance(item, Mapping) or "caps" not in item:
            raise ValueError(f"Rule {index + 1} has no caps")
        match = item.get("match") or {}
        _check_keys(match, {"provider", "model"}, f"rules[{index}].match")
        caps = item["caps"]
        Capabilities.from_mapping(caps)  # 尽早发现拼写错误
        rules.append(
            CapabilityRule(
                provider=match.get("provider"), model=match.get("model"), caps=caps, order=index
            )
        )
    return rules


def load_rules(path: Path = DEFAULT_RULES_PATH) -> list[CapabilityRule]:
    return parse_rules(yaml.safe_load(path.read_text(encoding="utf-8")))


def resolve_capabilities(
    provider: str,
    model: str,
    rules: Iterable[CapabilityRule],
    *,
    probed: Mapping[str, Any] | None = None,
    override: Mapping[str, Any] | None = None,
) -> Capabilities:
    merged: dict[str, Any] = {}
    for rule in sorted(
        (r for r in rules if r.matches(provider, model)), key=lambda r: r.specificity
    ):
        merged = deep_merge(merged, rule.caps)
    if probed:
        merged = deep_merge(merged, probed)
    if override:
        merged = deep_merge(merged, override)
    return Capabilities.from_mapping(merged)


class NegativeCapabilityCache:
    """线上请求因“不支持某能力”失败后，把该能力在这个凭据加模型上禁用一段时间（默认 1 小时）。"""

    def __init__(self, ttl_seconds: float = 3600.0, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl_seconds
        self._clock = clock
        self._entries: dict[tuple[str, str, str], float] = {}

    def add(self, credential_id: str, model: str, capability: str) -> None:
        self._entries[(credential_id, model, capability)] = self._clock() + self._ttl

    def disabled(self, credential_id: str, model: str) -> frozenset[str]:
        now = self._clock()
        result: set[str] = set()
        for (cred, mdl, capability), expires in list(self._entries.items()):
            if expires <= now:
                del self._entries[(cred, mdl, capability)]
            elif cred == credential_id and mdl == model:
                result.add(capability)
        return frozenset(result)
