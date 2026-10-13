"""消息转换：可组合的小函数，按后端对角色顺序的要求从宽到严分四档。

思路参考 SillyTavern 的 postProcessPrompt（merge / semi / strict / single），自行实现。
线上遇到消息格式类错误时升一档再试一次。
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import IntEnum

from .base import Message
from .capabilities import RoleCaps

# provider 层与故事语言无关，所以占位文字和角色标签都用中性写法
PLACEHOLDER_USER = "..."


class TransformLevel(IntEnum):
    NONE = 0
    MERGE = 1  # 合并相邻同角色消息
    STRICT = 2  # 另外保证 user / assistant 严格交替
    SINGLE_USER = 3  # 压成一条 user 消息


def _mergeable(message: Message) -> bool:
    return message.role in ("system", "user", "assistant") and not message.tool_calls


def merge_adjacent(messages: Sequence[Message]) -> list[Message]:
    merged: list[Message] = []
    for message in messages:
        if (
            merged
            and merged[-1].role == message.role
            and _mergeable(merged[-1])
            and _mergeable(message)
        ):
            previous = merged[-1]
            merged[-1] = Message(
                role=previous.role, content=f"{previous.content}\n\n{message.content}"
            )
        else:
            merged.append(message)
    return merged


def fold_system(messages: Sequence[Message]) -> list[Message]:
    """把所有 system 消息折进第一条 user 消息（给不支持 system 角色的后端）。"""
    system_parts = [m.content for m in messages if m.role == "system"]
    rest = [m for m in messages if m.role != "system"]
    if not system_parts:
        return list(rest)
    prefix = "\n\n".join(system_parts)
    for index, message in enumerate(rest):
        if message.role == "user":
            rest[index] = Message(role="user", content=f"{prefix}\n\n{message.content}")
            return rest
    return [Message(role="user", content=prefix), *rest]


def ensure_alternation(messages: Sequence[Message]) -> list[Message]:
    """合并相邻同角色消息，并保证第一条非 system 消息是 user。"""
    merged = merge_adjacent(messages)
    head = [m for m in merged if m.role == "system"]
    body = [m for m in merged if m.role != "system"]
    if body and body[0].role != "user":
        body.insert(0, Message(role="user", content=PLACEHOLDER_USER))
    return [*head, *body]


def single_user(messages: Sequence[Message]) -> list[Message]:
    blocks = [f"[{m.role}]\n{m.content}" for m in messages if m.content]
    return [Message(role="user", content="\n\n".join(blocks))]


def default_level(roles: RoleCaps) -> TransformLevel:
    return TransformLevel.STRICT if roles.alternation == "strict" else TransformLevel.NONE


def apply_transforms(
    messages: Sequence[Message], roles: RoleCaps, level: TransformLevel = TransformLevel.NONE
) -> list[Message]:
    effective = max(level, default_level(roles))
    if effective >= TransformLevel.SINGLE_USER:
        return single_user(messages)
    result = list(messages)
    if not roles.system:
        result = fold_system(result)
    if effective >= TransformLevel.STRICT:
        return ensure_alternation(result)
    if effective >= TransformLevel.MERGE:
        return merge_adjacent(result)
    return result


def next_level(level: TransformLevel) -> TransformLevel | None:
    if level >= TransformLevel.SINGLE_USER:
        return None
    return TransformLevel(level + 1)
