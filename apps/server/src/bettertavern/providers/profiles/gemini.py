"""Gemini（Google）：走官方的 OpenAI 兼容接口，基址 https://generativelanguage.googleapis.com/v1beta/openai。

依据 ai.google.dev 的 OpenAI 兼容、模型、思考、故障排查、安全设置文档（2026-10 读）：
- 思考用 reasoning_effort（minimal / low / medium / high），各模型认哪几档写在能力表里。
  Gemini 3 及以后、2.5 Pro 的思考关不掉，只有 2.5 Flash 系列能发 none。
  所以“深度思考”关着时发这个模型最低的一档（有 none 就发 none）；开着时不发，用模型自己的默认档。
- 思考用掉的 token 算在输出上限里。会思考时在输出上限上加一段余量，
  否则只给几百 token 的请求（修选项、连接测试）会被思考吃光、返回空：
  最低档加 2048，默认档加 16384，合计不超过能力表的 max_output。
- Gemini 4 和 3.6 及以后的模型忽略 temperature、top_p（官方说以后会直接报 400）：
  能力表里关掉，基类就不发。
- 结构化输出对 $defs / $ref 的支持文档没写清，而开局用的 Seed 正好用到：发出前把引用就地展开。
- 兼容接口的模型列表不给窗口，模型名可能带 models/ 前缀：去掉前缀，只留 gemini-* 的对话模型，
  窗口写在能力表里。
- 安全过滤：2.5 及以后的模型默认关闭，兼容接口也设不了，不处理。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any

from ..base import ChatRequest, ModelInfo
from ..capabilities import Capabilities
from ..profile import ProviderProfile

# “深度思考”关着时依次找这个模型认的档：能关就关，关不掉就用最低的一档
_LOWEST_FIRST = ("none", "minimal", "low")
# 会思考时给输出上限加的余量：关着（最低档）和开着（模型默认档）
THINKING_HEADROOM_LOW = 2048
THINKING_HEADROOM_DEFAULT = 16384

_CHAT_FAMILY = re.compile(r"^gemini-", re.IGNORECASE)
_NOT_CHAT = re.compile(
    r"embedding|image|tts|audio|live|robotics|computer-use|customtools", re.IGNORECASE
)


def _thinking_effort(req: ChatRequest, caps: Capabilities) -> tuple[str | None, int]:
    """这次请求要发的 reasoning_effort（None 表示不发），以及要加的输出余量。"""
    reasoning = req.reasoning
    if caps.reasoning.control != "effort":
        return None, 0
    if reasoning is not None and not reasoning.enabled:
        lowest = next((e for e in _LOWEST_FIRST if e in caps.reasoning.efforts), None)
        if lowest == "none":
            return lowest, 0
        return lowest, THINKING_HEADROOM_LOW
    if reasoning is not None and reasoning.effort in caps.reasoning.efforts:
        return reasoning.effort, THINKING_HEADROOM_DEFAULT
    return None, THINKING_HEADROOM_DEFAULT


def inline_refs(schema: Any) -> Any:
    """把 {"$ref": "#/$defs/名字"} 就地换成定义本身，去掉 $defs。

    和 $ref 写在一起的其他键（例如字段说明）保留，覆盖定义里的同名键。
    有自引用（展开不完）时原样返回，交给结构化输出阶梯在失败时降级。
    """
    if not isinstance(schema, Mapping):
        return schema
    defs = schema.get("$defs") or schema.get("definitions") or {}
    if not isinstance(defs, Mapping) or not defs:
        return schema

    class _Cycle(Exception):
        pass

    def resolve(node: Any, stack: tuple[str, ...]) -> Any:
        if isinstance(node, list):
            return [resolve(item, stack) for item in node]
        if not isinstance(node, Mapping):
            return node
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith(("#/$defs/", "#/definitions/")):
            name = ref.rsplit("/", 1)[-1]
            target = defs.get(name)
            if not isinstance(target, Mapping):
                return {k: resolve(v, stack) for k, v in node.items()}
            if name in stack:
                raise _Cycle
            expanded = dict(resolve(target, (*stack, name)))
            for key, value in node.items():
                if key != "$ref":
                    expanded[key] = resolve(value, stack)
            return expanded
        return {
            key: resolve(value, stack)
            for key, value in node.items()
            if key not in ("$defs", "definitions")
        }

    try:
        return resolve(schema, ())
    except _Cycle:
        return schema


@dataclass(frozen=True)
class GeminiProfile(ProviderProfile):
    def prepare_body(
        self, body: dict[str, Any], req: ChatRequest, caps: Capabilities
    ) -> dict[str, Any]:
        effort, headroom = _thinking_effort(req, caps)
        if effort is not None:
            body["reasoning_effort"] = effort
        if headroom and isinstance(body.get("max_tokens"), int):
            wanted = body["max_tokens"] + headroom
            limit = caps.max_output
            body["max_tokens"] = max(body["max_tokens"], min(wanted, limit) if limit else wanted)
        fmt = body.get("response_format")
        if isinstance(fmt, dict) and isinstance(fmt.get("json_schema"), dict):
            spec = fmt["json_schema"]
            spec["schema"] = inline_refs(spec.get("schema") or {})
        for tool in body.get("tools") or ():
            function = tool.get("function") if isinstance(tool, dict) else None
            if isinstance(function, dict) and "parameters" in function:
                function["parameters"] = inline_refs(function["parameters"])
        return body

    def parse_model(self, item: Mapping[str, Any]) -> ModelInfo | None:
        info = super().parse_model(item)
        if info is None:
            return None
        model_id = info.id.removeprefix("models/")
        if not _CHAT_FAMILY.match(model_id) or _NOT_CHAT.search(model_id):
            return None
        return replace(info, id=model_id)


PROFILE = GeminiProfile(
    id="gemini",
    display_name="Gemini",
    default_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
)
