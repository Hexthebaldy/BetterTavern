"""回合：玩家行动、回合状态与选项。

一个 turn = 玩家一次行动加导演一次回复，seq=0 是开场。点选项时客户端只发 option_id，
选项文字由服务端按已落库的选项解析，客户端不能伪造选项内容。
玩家选“写结局”时行动来源是 ending：导演写最后一段、不给选项，写完这局就结束了。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal

MAX_FREE_TEXT_CHARS = 2000
OPTION_IDS = ("o1", "o2")

ActionSource = Literal["option", "text", "opening", "ending"]
ACTION_SOURCES: tuple[ActionSource, ...] = ("option", "text", "opening", "ending")


class TurnStatus(StrEnum):
    GENERATING = "generating"
    REPLIED = "replied"  # 叙述与选项已落库，等 state 车道处理
    COMMITTED = "committed"  # state 车道已处理完（成功提交，或重试后放弃），屏障据此放行
    FAILED = "failed"
    ARCHIVED = "archived"  # 被回退

    @property
    def terminal_for_hot_path(self) -> bool:
        return self in (TurnStatus.REPLIED, TurnStatus.COMMITTED, TurnStatus.FAILED)

    @property
    def on_chain(self) -> bool:
        return self in (TurnStatus.REPLIED, TurnStatus.COMMITTED)


class OptionsSource(StrEnum):
    MODEL = "model"
    REPAIRED = "repaired"
    MISSING = "missing"  # 选项没补齐（不足 2 个）；早先的回合还可能是 fallback（用过默认选项）


class ActionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class TurnOption:
    id: str
    text: str

    def to_json(self) -> dict[str, str]:
        return {"id": self.id, "text": self.text}


def make_options(texts: Sequence[str]) -> list[TurnOption]:
    return [TurnOption(id=OPTION_IDS[i], text=t) for i, t in enumerate(texts[: len(OPTION_IDS)])]


def options_from_json(data: Any) -> list[TurnOption]:
    if not isinstance(data, list):
        return []
    result: list[TurnOption] = []
    for item in data:
        if isinstance(item, Mapping) and isinstance(item.get("id"), str):
            result.append(TurnOption(id=str(item["id"]), text=str(item.get("text", ""))))
    return result


@dataclass(frozen=True, slots=True)
class PlayerAction:
    """已解析的玩家行动：text 一律是服务端确定的文字（选项按 option_id 取已落库的文字）。"""

    source: ActionSource
    text: str
    option_id: str | None = None

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {"source": self.source, "text": self.text}
        if self.option_id is not None:
            data["option_id"] = self.option_id
        return data

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> PlayerAction:
        source = data.get("source")
        if source not in ACTION_SOURCES:
            raise ActionError("VALIDATION_ERROR", f"Unknown action source: {source!r}")
        option_id = data.get("option_id")
        return cls(
            source=source,
            text=str(data.get("text", "")),
            option_id=str(option_id) if option_id is not None else None,
        )


def resolve_action(
    source: str,
    *,
    text: str | None,
    option_id: str | None,
    parent_options: Sequence[TurnOption],
) -> PlayerAction:
    """校验客户端提交的行动并解析成服务端确定的文字。"""
    if source == "option":
        if not option_id:
            raise ActionError("VALIDATION_ERROR", "option_id is required when picking a choice")
        match = next((o for o in parent_options if o.id == option_id), None)
        if match is None:
            raise ActionError(
                "OPTION_NOT_FOUND", "That choice doesn't exist; it may have been regenerated"
            )
        return PlayerAction(source="option", text=match.text, option_id=match.id)
    if source == "text":
        cleaned = (text or "").strip()
        if not cleaned:
            raise ActionError("VALIDATION_ERROR", "The text can't be empty")
        if len(cleaned) > MAX_FREE_TEXT_CHARS:
            raise ActionError(
                "VALIDATION_ERROR", f"The text can be at most {MAX_FREE_TEXT_CHARS} characters"
            )
        return PlayerAction(source="text", text=cleaned)
    if source == "opening":
        return PlayerAction(source="opening", text="")
    if source == "ending":
        # 结局的方向可以不填
        cleaned = (text or "").strip()
        if len(cleaned) > MAX_FREE_TEXT_CHARS:
            raise ActionError(
                "VALIDATION_ERROR",
                f"The ending wish can be at most {MAX_FREE_TEXT_CHARS} characters",
            )
        return PlayerAction(source="ending", text=cleaned)
    raise ActionError("VALIDATION_ERROR", f"Unknown action source: {source!r}")


def clip_middle(text: str, limit: int, ellipsis: str = "……") -> str:
    """超长时保留首尾，中间用省略号（玩家行动块的降级方式）。"""
    if len(text) <= limit:
        return text
    keep = max(limit - len(ellipsis), 2)
    head = keep // 2 + keep % 2
    tail = keep // 2
    return text[:head] + ellipsis + (text[-tail:] if tail else "")
