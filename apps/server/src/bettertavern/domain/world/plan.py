"""把 Seed 展开成要写入世界表的实体、关系和事实（纯函数，不碰数据库）。

实体用本地键（kind:name_norm）互相引用，服务层插入后再换成真实 ID。
开局的实体一律 canon（钢笔）、first_seq = 0；开局不写 state_patches，因为不能回退到开场之前。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .names import normalize_name
from .seed import Seed

EntityKind = Literal["character", "item", "location", "organization", "world"]

REL_LOCATED_IN = "located_in"
REL_HELD_BY = "held_by"
REL_MEMBER_OF = "member_of"

WORLD_ENTITY_NAME = "世界"


def entity_key(kind: str, name: str) -> str:
    return f"{kind}:{normalize_name(name)}"


@dataclass
class EntityDraft:
    key: str
    kind: EntityKind
    name: str
    aliases: list[str]
    summary: str
    data: dict[str, Any]
    is_protagonist: bool = False

    @property
    def name_norm(self) -> str:
        return normalize_name(self.name)


@dataclass(frozen=True)
class LinkDraft:
    src: str
    rel: str
    dst: str


@dataclass(frozen=True)
class FactDraft:
    text: str
    entities: tuple[str, ...]
    secret: bool
    known_by: tuple[str, ...]


@dataclass
class WorldPlan:
    entities: list[EntityDraft] = field(default_factory=list)
    links: list[LinkDraft] = field(default_factory=list)
    facts: list[FactDraft] = field(default_factory=list)
    world_key: str = ""
    protagonist_key: str = ""
    scene_location: str | None = None
    scene_present: list[str] = field(default_factory=list)


def _aliases(name: str, aliases: list[str]) -> list[str]:
    own = normalize_name(name)
    seen: set[str] = set()
    result: list[str] = []
    for alias in aliases:
        norm = normalize_name(alias)
        if norm and norm != own and norm not in seen:
            seen.add(norm)
            result.append(alias)
    return result


def plan_world(seed: Seed) -> WorldPlan:
    plan = WorldPlan()
    keys: dict[str, str] = {}  # name_norm → key（人物、地点、物品、组织之间名字唯一时用）

    def add(draft: EntityDraft) -> None:
        if any(e.key == draft.key for e in plan.entities):
            return
        plan.entities.append(draft)
        keys.setdefault(normalize_name(draft.name), draft.key)

    world = seed.world
    world_key = entity_key("world", WORLD_ENTITY_NAME)
    summary_parts = [p for p in (world.setting, world.tone) if p]
    plan.world_key = world_key
    add(
        EntityDraft(
            key=world_key,
            kind="world",
            name=WORLD_ENTITY_NAME,
            aliases=[world.title] if world.title else [],
            summary="\n".join(summary_parts),
            data={
                "title": world.title,
                "tone": world.tone,
                "rules": list(world.rules),
                "style": world.style,
                "clock": None,
                "scene": {"location": None, "present": [], "goal": seed.protagonist.goal},
            },
        )
    )

    hero = seed.protagonist
    plan.protagonist_key = entity_key("character", hero.name)
    add(
        EntityDraft(
            key=plan.protagonist_key,
            kind="character",
            name=hero.name,
            aliases=[],
            summary=hero.summary,
            data={"goal": hero.goal},
            is_protagonist=True,
        )
    )
    for c in seed.characters:
        add(
            EntityDraft(
                key=entity_key("character", c.name),
                kind="character",
                name=c.name,
                aliases=_aliases(c.name, c.aliases),
                summary=c.summary,
                data={
                    k: v
                    for k, v in {
                        "goal": c.goal,
                        "attitude": c.attitude,
                        "speech_style": c.speech_style,
                    }.items()
                    if v
                },
            )
        )
    for loc in seed.locations:
        add(
            EntityDraft(
                key=entity_key("location", loc.name),
                kind="location",
                name=loc.name,
                aliases=_aliases(loc.name, loc.aliases),
                summary=loc.summary,
                data={},
            )
        )
    for org in seed.organizations:
        add(
            EntityDraft(
                key=entity_key("organization", org.name),
                kind="organization",
                name=org.name,
                aliases=_aliases(org.name, org.aliases),
                summary=org.summary,
                data={"stance": org.stance} if org.stance else {},
            )
        )
    for item in seed.items:
        add(
            EntityDraft(
                key=entity_key("item", item.name),
                kind="item",
                name=item.name,
                aliases=_aliases(item.name, item.aliases),
                summary=item.summary,
                data={},
            )
        )

    def link(src: str, rel: str, dst: str) -> None:
        draft = LinkDraft(src, rel, dst)
        if src != dst and draft not in plan.links:
            plan.links.append(draft)

    for item in seed.items:
        key = entity_key("item", item.name)
        if item.holder:
            link(key, REL_HELD_BY, entity_key("character", item.holder))
        elif item.location:
            link(key, REL_LOCATED_IN, entity_key("location", item.location))
    for org in seed.organizations:
        for member in org.members:
            link(
                entity_key("character", member), REL_MEMBER_OF, entity_key("organization", org.name)
            )

    opening = seed.opening
    if opening.location:
        loc_key = entity_key("location", opening.location)
        plan.scene_location = loc_key
        link(plan.protagonist_key, REL_LOCATED_IN, loc_key)
        for person in opening.present:
            link(entity_key("character", person), REL_LOCATED_IN, loc_key)
    plan.scene_present = [entity_key("character", p) for p in opening.present]

    known = {e.key for e in plan.entities}
    plan.links = [lk for lk in plan.links if lk.src in known and lk.dst in known]
    plan.scene_present = [k for k in plan.scene_present if k in known]

    for fact in seed.facts:
        refs = tuple(dict.fromkeys(keys[n] for a in fact.about if (n := normalize_name(a)) in keys))
        knowers = tuple(
            dict.fromkeys(
                keys[n]
                for a in fact.known_by
                if (n := normalize_name(a)) in keys and keys[n].startswith("character:")
            )
        )
        plan.facts.append(
            FactDraft(
                text=fact.text,
                entities=refs,
                secret=fact.secret,
                known_by=knowers,
            )
        )
    return plan
