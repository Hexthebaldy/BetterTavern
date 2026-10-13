"""DeepSeek：OpenAI 格式，思考模式用 thinking 开关，推理文本在 reasoning_content。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..base import ChatRequest
from ..capabilities import Capabilities
from ..profile import ProviderProfile


def _strip_empty_required(schema: Any) -> Any:
    """去掉空的 required 数组（参考 ST 的 sendDeepSeekRequest 的做法）。"""
    if isinstance(schema, Mapping):
        cleaned = {
            key: _strip_empty_required(value)
            for key, value in schema.items()
            if not (key == "required" and isinstance(value, list) and not value)
        }
        return cleaned
    if isinstance(schema, list):
        return [_strip_empty_required(item) for item in schema]
    return schema


@dataclass(frozen=True)
class DeepSeekProfile(ProviderProfile):
    def prepare_body(
        self, body: dict[str, Any], req: ChatRequest, caps: Capabilities
    ) -> dict[str, Any]:
        reasoning = req.reasoning
        if reasoning is not None and caps.reasoning.control == "thinking_toggle":
            body["thinking"] = {"type": "enabled" if reasoning.enabled else "disabled"}
            if (
                reasoning.enabled
                and reasoning.effort
                and (not caps.reasoning.efforts or reasoning.effort in caps.reasoning.efforts)
            ):
                body["reasoning_effort"] = reasoning.effort
        tools = body.get("tools")
        if isinstance(tools, list):
            body["tools"] = _strip_empty_required(tools)
        return body


PROFILE = DeepSeekProfile(
    id="deepseek",
    display_name="DeepSeek",
    default_base_url="https://api.deepseek.com",
)
