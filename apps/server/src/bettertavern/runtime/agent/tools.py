"""工具注册表（docs/agent-runtime.md 第 5 节“工具”）。

一个工具 = 名字 + 参数的 JSON 格式 + 读还是写 + 返回内容的长度上限 + 执行函数。
给模型看的说明和出错时的提示是提示词，按语言放在 `runtime/prompts/<lang>/tools.json`
（说明按 agent 分组）。

调用时的规矩：
- agent 的定义里没有这个工具，或者注册表里没有：不执行，告诉模型“没有这个工具”；
- 参数不是 JSON 对象、缺了必填项、类型不对：不执行，把错误说明交回模型，让它自己改；
- 执行函数抛 `ToolError`：把它的说明交回模型；其他异常照常抛出（是代码的问题，不是模型的）；
- 返回内容先过 `sanitize_for_fence()`、按上限截断；读工具的结果再用 `<recall>` 包起来，
  防止旧回合里玩家写的文字冒充指令。
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from bettertavern.providers import ToolCall, ToolSpec
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.prompts import PromptLibrary

from .spec import AgentSpec

ToolHandler = Callable[[Mapping[str, Any], Any], Awaitable[str]]

_JSON_TYPES: Mapping[str, tuple[type, ...]] = {
    "string": (str,),
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "array": (list,),
    "object": (dict,),
}


class ToolError(Exception):
    """执行函数遇到的、应当告诉模型的问题（比如查无此人）。说明会原样交回模型。"""


@dataclass(frozen=True, slots=True)
class Tool:
    name: str
    kind: Literal["read", "write"]
    parameters: Mapping[str, Any]  # JSON Schema，顶层是 object
    handler: ToolHandler
    max_result_chars: int = 3000


@dataclass(frozen=True, slots=True)
class ToolOutcome:
    text: str  # 交回模型的内容
    error: str | None = None  # unknown_tool / bad_arguments / failed；成功时为 None
    args: Mapping[str, Any] | None = None  # 解析出的参数，记进 agent_steps


class ToolRegistry:
    def __init__(self, tools: Iterable[Tool] = ()) -> None:
        self._tools: dict[str, Tool] = {}
        for tool in tools:
            self.register(tool)

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"tool {tool.name} is already registered")
        if tool.parameters.get("type") != "object":
            raise ValueError(f"tool {tool.name} parameters must be a JSON object schema")
        self._tools[tool.name] = tool

    def __contains__(self, name: object) -> bool:
        return name in self._tools

    def specs(
        self, agent: AgentSpec, prompts: PromptLibrary, *, only: Collection[str] | None = None
    ) -> list[ToolSpec]:
        """这个 agent 能用的工具（only 给出时只取其中这几个），给模型看的形式。
        说明按这一局的语言取，按 agent 分组：同名的工具在不同 agent 里可以是不同的意思。"""
        descriptions: Mapping[str, str] = prompts.data("tools")["descriptions"][agent.name]
        return [
            ToolSpec(
                name=name,
                description=descriptions[name],
                parameters=self._tools[name].parameters,
            )
            for name in agent.tools
            if only is None or name in only
        ]

    async def call(
        self,
        agent: AgentSpec,
        call: ToolCall,
        ctx: Any,
        prompts: PromptLibrary,
        *,
        allowed: Collection[str] | None = None,
    ) -> ToolOutcome:
        """allowed 是这一轮提供给模型的工具名；不在里面的不执行。"""
        errors: Mapping[str, str] = prompts.data("tools")["errors"]
        tool = self._tools.get(call.name)
        offered = call.name in agent.tools and (allowed is None or call.name in allowed)
        if tool is None or not offered:
            return ToolOutcome(
                text=errors["unknown_tool"].format(name=sanitize_for_fence(call.name)[:80]),
                error="unknown_tool",
            )
        try:
            args = parse_arguments(call.arguments, tool.parameters)
        except ValueError as exc:
            return ToolOutcome(
                text=errors["bad_arguments"].format(detail=str(exc)), error="bad_arguments"
            )
        try:
            raw = await tool.handler(args, ctx)
        except ToolError as exc:
            return ToolOutcome(
                text=errors["failed"].format(detail=sanitize_for_fence(str(exc))),
                error="failed",
                args=args,
            )
        text = sanitize_for_fence(raw)
        if len(text) > tool.max_result_chars:
            text = text[: tool.max_result_chars] + "…"
        if tool.kind == "read":
            text = f"<recall>\n{text}\n</recall>"
        return ToolOutcome(text=text, args=args)


def parse_arguments(raw: str, schema: Mapping[str, Any]) -> dict[str, Any]:
    """模型给的参数是一段 JSON 文本：必须是对象，必填项要有，声明了类型的要对得上。"""
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"arguments are not valid JSON ({exc.msg})") from exc
    if not isinstance(value, dict):
        raise ValueError("arguments must be a JSON object")
    properties: Mapping[str, Any] = schema.get("properties") or {}
    required: Sequence[str] = schema.get("required") or ()
    missing = [name for name in required if name not in value]
    if missing:
        raise ValueError(f"missing required arguments: {', '.join(missing)}")
    for name, item in value.items():
        declared = properties.get(name)
        if declared is None:
            if schema.get("additionalProperties") is False:
                raise ValueError(f"unknown argument: {name}")
            continue
        expected = _JSON_TYPES.get(str(declared.get("type", "")))
        if expected is None:
            continue
        # JSON 里 true / false 不算整数
        wrong_bool = isinstance(item, bool) and bool not in expected
        if wrong_bool or not isinstance(item, expected):
            raise ValueError(f"argument {name} should be {declared['type']}")
    return value
