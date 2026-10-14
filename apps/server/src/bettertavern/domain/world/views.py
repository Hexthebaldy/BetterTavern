"""世界状态的只读快照：装配上下文和世界浏览都从它读。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .plan import REL_HELD_BY, REL_LOCATED_IN, REL_MEMBER_OF


@dataclass(frozen=True, slots=True)
class EntityView:
    id: str
    kind: str
    name: str
    aliases: tuple[str, ...] = ()
    summary: str = ""
    data: Mapping[str, Any] = field(default_factory=dict)
    importance: int = 2
    is_protagonist: bool = False
    canon: str = "canon"


@dataclass(frozen=True, slots=True)
class LinkView:
    src_id: str
    rel: str
    dst_id: str


@dataclass(frozen=True, slots=True)
class FactView:
    id: str
    text: str
    entity_ids: tuple[str, ...] = ()
    importance: int = 2
    visibility: str = "public"
    known_by: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorldSnapshot:
    entities: tuple[EntityView, ...] = ()
    links: tuple[LinkView, ...] = ()
    facts: tuple[FactView, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "_by_id", {e.id: e for e in self.entities})

    def get(self, entity_id: str) -> EntityView | None:
        by_id: dict[str, EntityView] = object.__getattribute__(self, "_by_id")
        return by_id.get(entity_id)

    @property
    def world(self) -> EntityView | None:
        return next((e for e in self.entities if e.kind == "world"), None)

    @property
    def protagonist(self) -> EntityView | None:
        return next((e for e in self.entities if e.is_protagonist), None)

    def of_kind(self, kind: str) -> list[EntityView]:
        return [e for e in self.entities if e.kind == kind and not e.is_protagonist]

    def targets(self, src_id: str, rel: str) -> list[EntityView]:
        return [
            e
            for link in self.links
            if link.src_id == src_id and link.rel == rel
            if (e := self.get(link.dst_id)) is not None
        ]

    def sources(self, dst_id: str, rel: str) -> list[EntityView]:
        return [
            e
            for link in self.links
            if link.dst_id == dst_id and link.rel == rel
            if (e := self.get(link.src_id)) is not None
        ]

    def location_of(self, entity_id: str) -> EntityView | None:
        places = self.targets(entity_id, REL_LOCATED_IN)
        return places[0] if places else None

    def held_by(self, character_id: str) -> list[EntityView]:
        return self.sources(character_id, REL_HELD_BY)

    def members_of(self, org_id: str) -> list[EntityView]:
        return self.sources(org_id, REL_MEMBER_OF)

    def scene(self) -> tuple[EntityView | None, list[EntityView]]:
        """当前场景：地点与在场人物（不含主角）。优先用 world 实体里记录的场景。"""
        world = self.world
        scene = dict((world.data.get("scene") or {}) if world else {})
        location = self.get(str(scene.get("location"))) if scene.get("location") else None
        hero = self.protagonist
        if location is None and hero is not None:
            location = self.location_of(hero.id)
        present_ids = [str(p) for p in scene.get("present") or []]
        present = [e for pid in present_ids if (e := self.get(pid)) is not None]
        if location is not None:
            for person in self.sources(location.id, REL_LOCATED_IN):
                if (
                    person.kind == "character"
                    and not person.is_protagonist
                    and person not in present
                ):
                    present.append(person)
        return location, present

    def facts_about(self, entity_id: str) -> list[FactView]:
        return [f for f in self.facts if entity_id in f.entity_ids]
