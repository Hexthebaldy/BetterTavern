"""世界状态表里一行的完整内容：实体、关系、事实、线索。

世界状态 agent 改的就是这些行。每改一行，改之前和改之后的样子都记进 state_patches，回退时按记录
写回（docs/agent-runtime.md 第 8 节）。字段和数据库的列一一对应，转成 JSON 时也用列名。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

Target = Literal["entity", "link", "fact", "thread"]


@dataclass(frozen=True, slots=True)
class EntityRecord:
    id: str
    kind: str
    name: str
    name_norm: str
    aliases: tuple[str, ...] = ()
    summary: str = ""
    data: Mapping[str, Any] = field(default_factory=dict)
    canon: str = "canon"
    is_protagonist: bool = False
    first_seq: int = 0
    last_seen_seq: int = 0
    rev: int = 1
    retired: bool = False

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "name_norm": self.name_norm,
            "aliases": list(self.aliases),
            "summary": self.summary,
            "data": dict(self.data),
            "canon": self.canon,
            "is_protagonist": self.is_protagonist,
            "first_seq": self.first_seq,
            "last_seen_seq": self.last_seen_seq,
            "rev": self.rev,
            "retired": self.retired,
        }

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> EntityRecord:
        return cls(
            id=str(data["id"]),
            kind=str(data["kind"]),
            name=str(data["name"]),
            name_norm=str(data["name_norm"]),
            aliases=tuple(str(a) for a in data.get("aliases") or ()),
            summary=str(data.get("summary") or ""),
            data=dict(data.get("data") or {}),
            canon=str(data.get("canon") or "canon"),
            is_protagonist=bool(data.get("is_protagonist")),
            first_seq=int(data.get("first_seq") or 0),
            last_seen_seq=int(data.get("last_seen_seq") or 0),
            rev=int(data.get("rev") or 1),
            retired=bool(data.get("retired")),
        )


@dataclass(frozen=True, slots=True)
class LinkRecord:
    src_id: str
    rel: str
    dst_id: str
    since_seq: int = 0

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.src_id, self.rel, self.dst_id)

    def to_json(self) -> dict[str, Any]:
        return {
            "src_id": self.src_id,
            "rel": self.rel,
            "dst_id": self.dst_id,
            "since_seq": self.since_seq,
        }

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> LinkRecord:
        return cls(
            src_id=str(data["src_id"]),
            rel=str(data["rel"]),
            dst_id=str(data["dst_id"]),
            since_seq=int(data.get("since_seq") or 0),
        )


@dataclass(frozen=True, slots=True)
class FactRecord:
    id: str
    text: str
    entity_ids: tuple[str, ...] = ()
    visibility: str = "public"
    known_by: tuple[str, ...] = ()
    status: str = "active"
    superseded_by: str | None = None
    superseded_seq: int | None = None
    created_seq: int = 0
    source_turn_id: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "entity_ids": list(self.entity_ids),
            "visibility": self.visibility,
            "known_by": list(self.known_by),
            "status": self.status,
            "superseded_by": self.superseded_by,
            "superseded_seq": self.superseded_seq,
            "created_seq": self.created_seq,
            "source_turn_id": self.source_turn_id,
        }

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> FactRecord:
        superseded_seq = data.get("superseded_seq")
        return cls(
            id=str(data["id"]),
            text=str(data["text"]),
            entity_ids=tuple(str(x) for x in data.get("entity_ids") or ()),
            visibility=str(data.get("visibility") or "public"),
            known_by=tuple(str(x) for x in data.get("known_by") or ()),
            status=str(data.get("status") or "active"),
            superseded_by=_opt_str(data.get("superseded_by")),
            superseded_seq=int(superseded_seq) if superseded_seq is not None else None,
            created_seq=int(data.get("created_seq") or 0),
            source_turn_id=_opt_str(data.get("source_turn_id")),
        )


@dataclass(frozen=True, slots=True)
class ThreadRecord:
    """一条线索：还没解开的悬念（mystery）、答应过的事（promise）、埋下的伏笔（foreshadow）。"""

    id: str
    kind: str
    text: str
    entity_ids: tuple[str, ...] = ()
    status: str = "open"  # open / closed / merged（合进了另一条）
    opened_seq: int = 0
    closed_seq: int | None = None  # 解开或合并的回合
    source_turn_id: str | None = None
    answer: str = ""  # 导演定下的答案，只给导演看
    merged_into: str | None = None  # 合进了哪一条

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "text": self.text,
            "entity_ids": list(self.entity_ids),
            "status": self.status,
            "opened_seq": self.opened_seq,
            "closed_seq": self.closed_seq,
            "source_turn_id": self.source_turn_id,
            "answer": self.answer,
            "merged_into": self.merged_into,
        }

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> ThreadRecord:
        closed_seq = data.get("closed_seq")
        return cls(
            id=str(data["id"]),
            kind=str(data["kind"]),
            text=str(data["text"]),
            entity_ids=tuple(str(x) for x in data.get("entity_ids") or ()),
            status=str(data.get("status") or "open"),
            opened_seq=int(data.get("opened_seq") or 0),
            closed_seq=int(closed_seq) if closed_seq is not None else None,
            source_turn_id=_opt_str(data.get("source_turn_id")),
            answer=str(data.get("answer") or ""),
            merged_into=_opt_str(data.get("merged_into")),
        )


def _opt_str(value: Any) -> str | None:
    return None if value is None else str(value)


@dataclass(frozen=True, slots=True)
class RowChange:
    """一行的一次改动。before 为空表示这一行是新建的，after 为空表示这一行被删了。"""

    target: Target
    before: Mapping[str, Any] | None
    after: Mapping[str, Any] | None


@dataclass(frozen=True)
class WorldRecords:
    """一局世界状态的全部行：实体（包括已退场的）、关系、有效的事实、没解开的线索。"""

    entities: tuple[EntityRecord, ...] = ()
    links: tuple[LinkRecord, ...] = ()
    facts: tuple[FactRecord, ...] = ()
    threads: tuple[ThreadRecord, ...] = ()
