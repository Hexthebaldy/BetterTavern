"""回合：玩家行动、回合状态与选项。

一个 turn = 玩家一次行动加导演一次回复，seq=0 是开场。点选项时客户端只发 option_id，
选项文字由服务端按已落库的选项解析，客户端不能伪造选项内容。
玩家选“写结局”时行动来源是 ending：导演写最后一段、不给选项，写完这局就结束了。
多角色的局（domain/story/cast.py）还有两样：行动可以点名（speakers，这一回合让谁说话），
行动来源 continue 是玩家这一回合不行动、让他们接着说。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any, Literal

from .cast import CastMember, Speaker, is_group, parse_speaker

MAX_FREE_TEXT_CHARS = 2000
OPTION_IDS = ("o1", "o2")

ActionSource = Literal["option", "text", "opening", "ending", "continue"]
ACTION_SOURCES: tuple[ActionSource, ...] = ("option", "text", "opening", "ending", "continue")
# 可以点名的行动来源（多角色的局）
CAST_SOURCES: tuple[ActionSource, ...] = ("option", "text", "continue")


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
    # 点名：这一回合让谁说话，按点的顺序（角色的位置，旁白是 None）；没点名时为空
    speakers: tuple[Speaker, ...] = ()

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {"source": self.source, "text": self.text}
        if self.option_id is not None:
            data["option_id"] = self.option_id
        if self.speakers:
            data["speakers"] = list(self.speakers)
        return data

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> PlayerAction:
        source = data.get("source")
        if source not in ACTION_SOURCES:
            raise ActionError("VALIDATION_ERROR", f"Unknown action source: {source!r}")
        option_id = data.get("option_id")
        raw = data.get("speakers")
        speakers: list[Speaker] = []
        for value in raw if isinstance(raw, list) else ():
            try:
                speakers.append(parse_speaker(value))
            except ValueError:
                continue
        return cls(
            source=source,
            text=str(data.get("text", "")),
            option_id=str(option_id) if option_id is not None else None,
            speakers=tuple(speakers),
        )


def resolve_action(
    source: str,
    *,
    text: str | None,
    option_id: str | None,
    parent_options: Sequence[TurnOption],
    speakers: Sequence[Speaker] = (),
    cast: Sequence[CastMember] = (),
) -> PlayerAction:
    """校验客户端提交的行动并解析成服务端确定的文字。cast 是这一局的角色（不是多角色的局时为空）：
    只有多角色的局能点名、能让他们接着说；点名只能点这一局的角色和旁白。"""
    group = is_group(cast)
    if (speakers or source == "continue") and not group:
        raise ActionError("VALIDATION_ERROR", "This story has no cast to pick speakers from")
    if speakers and source not in CAST_SOURCES:
        raise ActionError("VALIDATION_ERROR", f"Speakers can't be picked for a {source} action")
    positions = {m.position for m in cast}
    if any(s is not None and s not in positions for s in speakers):
        raise ActionError("VALIDATION_ERROR", "Unknown speaker")
    picked = tuple(dict.fromkeys(speakers))
    action = _resolve(source, text=text, option_id=option_id, parent_options=parent_options)
    return replace(action, speakers=picked) if picked else action


def _resolve(
    source: str,
    *,
    text: str | None,
    option_id: str | None,
    parent_options: Sequence[TurnOption],
) -> PlayerAction:
    if source == "continue":
        return PlayerAction(source="continue", text="")
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
