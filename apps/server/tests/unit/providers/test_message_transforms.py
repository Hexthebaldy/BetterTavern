from __future__ import annotations

from bettertavern.providers.base import Message, ToolCall
from bettertavern.providers.capabilities import RoleCaps
from bettertavern.providers.message_transforms import (
    PLACEHOLDER_USER,
    TransformLevel,
    apply_transforms,
    merge_adjacent,
    next_level,
)

SYSTEM = Message(role="system", content="规则")


def test_none_level_keeps_messages() -> None:
    messages = [SYSTEM, Message(role="user", content="a"), Message(role="user", content="b")]
    assert apply_transforms(messages, RoleCaps()) == messages


def test_merge_adjacent_same_roles() -> None:
    messages = [
        SYSTEM,
        Message(role="user", content="a"),
        Message(role="user", content="b"),
        Message(role="assistant", content="c"),
    ]
    merged = merge_adjacent(messages)
    assert [m.role for m in merged] == ["system", "user", "assistant"]
    assert merged[1].content == "a\n\nb"


def test_tool_messages_are_not_merged() -> None:
    call = ToolCall(id="1", name="f", arguments="{}")
    messages = [
        Message(role="assistant", content="", tool_calls=(call,)),
        Message(role="assistant", content="after"),
    ]
    assert merge_adjacent(messages) == messages


def test_strict_alternation_inserts_user_placeholder() -> None:
    messages = [
        SYSTEM,
        Message(role="assistant", content="开场"),
        Message(role="user", content="我"),
    ]
    result = apply_transforms(messages, RoleCaps(alternation="strict"))
    assert [m.role for m in result] == ["system", "user", "assistant", "user"]
    assert result[1].content == PLACEHOLDER_USER


def test_fold_system_when_unsupported() -> None:
    messages = [SYSTEM, Message(role="user", content="行动")]
    result = apply_transforms(messages, RoleCaps(system=False))
    assert result == [Message(role="user", content="规则\n\n行动")]


def test_single_user() -> None:
    messages = [SYSTEM, Message(role="user", content="a"), Message(role="assistant", content="b")]
    result = apply_transforms(messages, RoleCaps(), TransformLevel.SINGLE_USER)
    assert len(result) == 1
    assert result[0].role == "user"
    assert "[system]\n规则" in result[0].content
    assert result[0].content.endswith("[assistant]\nb")


def test_next_level() -> None:
    assert next_level(TransformLevel.NONE) is TransformLevel.MERGE
    assert next_level(TransformLevel.SINGLE_USER) is None
