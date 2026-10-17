"""开局设定 Seed：WorldBuilder 的输出，也是最小 Seed 的形态。

模型输出是不可信的：字符串超长就截断、列表超长就截掉，而不是整体拒绝；
名字之间的引用（谁在场、谁拿着什么）在 normalize_seed() 里统一校正。
给模型看的字段说明随一局的语言，放在 runtime/prompts/<lang>/schema/seed.json，这里不写。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from bettertavern.domain.scenario.card import CharacterCard, apply_macros

from .names import clean_display_name, normalize_name

NAME_CHARS = 40


def _clip(limit: int) -> Callable[[Any], Any]:
    def clip(value: Any) -> Any:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()[:limit]
        return value

    return clip


def _clip_list(limit: int, item_chars: int | None = None) -> Callable[[Any], Any]:
    def clip(value: Any) -> Any:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if isinstance(value, list):
            items = value[:limit]
            if item_chars is not None:
                items = [str(i).strip()[:item_chars] for i in items if str(i).strip()]
            return items
        return value

    return clip


class _SeedModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class WorldSeed(_SeedModel):
    title: str = Field(default="")
    setting: str = Field(default="")
    tone: str = Field(default="")
    rules: list[str] = Field(default_factory=list)
    style: str = Field(default="")

    _title = field_validator("title", mode="before")(_clip(40))
    _setting = field_validator("setting", mode="before")(_clip(800))
    _tone = field_validator("tone", mode="before")(_clip(200))
    _rules = field_validator("rules", mode="before")(_clip_list(8, 160))
    _style = field_validator("style", mode="before")(_clip(200))


class ProtagonistSeed(_SeedModel):
    name: str
    summary: str = Field(default="")
    goal: str = Field(default="")

    _name = field_validator("name", mode="before")(_clip(NAME_CHARS))
    _summary = field_validator("summary", mode="before")(_clip(400))
    _goal = field_validator("goal", mode="before")(_clip(160))


class CharacterSeed(_SeedModel):
    name: str
    aliases: list[str] = Field(default_factory=list)
    summary: str = Field(default="")
    goal: str = Field(default="")
    attitude: str = Field(default="")
    speech_style: str = Field(default="")
    importance: int = Field(default=3, ge=1, le=5)

    _name = field_validator("name", mode="before")(_clip(NAME_CHARS))
    _aliases = field_validator("aliases", mode="before")(_clip_list(6, NAME_CHARS))
    _summary = field_validator("summary", mode="before")(_clip(500))
    _goal = field_validator("goal", mode="before")(_clip(160))
    _attitude = field_validator("attitude", mode="before")(_clip(160))
    _speech = field_validator("speech_style", mode="before")(_clip(240))

    @field_validator("importance", mode="before")
    @classmethod
    def _importance(cls, value: Any) -> Any:
        return _clamp_importance(value)


class LocationSeed(_SeedModel):
    name: str
    aliases: list[str] = Field(default_factory=list)
    summary: str = Field(default="")
    importance: int = Field(default=3, ge=1, le=5)

    _name = field_validator("name", mode="before")(_clip(NAME_CHARS))
    _aliases = field_validator("aliases", mode="before")(_clip_list(6, NAME_CHARS))
    _summary = field_validator("summary", mode="before")(_clip(400))

    @field_validator("importance", mode="before")
    @classmethod
    def _importance(cls, value: Any) -> Any:
        return _clamp_importance(value)


class ItemSeed(_SeedModel):
    name: str
    aliases: list[str] = Field(default_factory=list)
    summary: str = Field(default="")
    holder: str | None = Field(default=None)
    location: str | None = Field(default=None)
    importance: int = Field(default=2, ge=1, le=5)

    _name = field_validator("name", mode="before")(_clip(NAME_CHARS))
    _aliases = field_validator("aliases", mode="before")(_clip_list(6, NAME_CHARS))
    _summary = field_validator("summary", mode="before")(_clip(300))

    @field_validator("importance", mode="before")
    @classmethod
    def _importance(cls, value: Any) -> Any:
        return _clamp_importance(value)


class OrgSeed(_SeedModel):
    name: str
    aliases: list[str] = Field(default_factory=list)
    summary: str = Field(default="")
    stance: str = Field(default="")
    members: list[str] = Field(default_factory=list)
    importance: int = Field(default=2, ge=1, le=5)

    _name = field_validator("name", mode="before")(_clip(NAME_CHARS))
    _aliases = field_validator("aliases", mode="before")(_clip_list(6, NAME_CHARS))
    _summary = field_validator("summary", mode="before")(_clip(300))
    _stance = field_validator("stance", mode="before")(_clip(120))
    _members = field_validator("members", mode="before")(_clip_list(24, NAME_CHARS))

    @field_validator("importance", mode="before")
    @classmethod
    def _importance(cls, value: Any) -> Any:
        return _clamp_importance(value)


class FactSeed(_SeedModel):
    text: str
    about: list[str] = Field(default_factory=list)
    importance: int = Field(default=2, ge=1, le=5)
    secret: bool = Field(default=False)
    known_by: list[str] = Field(default_factory=list)

    _text = field_validator("text", mode="before")(_clip(200))
    _about = field_validator("about", mode="before")(_clip_list(6, NAME_CHARS))
    _known = field_validator("known_by", mode="before")(_clip_list(12, NAME_CHARS))

    @field_validator("importance", mode="before")
    @classmethod
    def _importance(cls, value: Any) -> Any:
        return _clamp_importance(value)


class OpeningBrief(_SeedModel):
    location: str | None = Field(default=None)
    present: list[str] = Field(default_factory=list)
    situation: str = Field(default="")
    hook: str = Field(default="")

    _present = field_validator("present", mode="before")(_clip_list(8, NAME_CHARS))
    _situation = field_validator("situation", mode="before")(_clip(500))
    _hook = field_validator("hook", mode="before")(_clip(200))


class Seed(_SeedModel):
    world: WorldSeed = Field(default_factory=WorldSeed)
    protagonist: ProtagonistSeed
    characters: list[CharacterSeed] = Field(default_factory=list)
    locations: list[LocationSeed] = Field(default_factory=list)
    items: list[ItemSeed] = Field(default_factory=list)
    organizations: list[OrgSeed] = Field(default_factory=list)
    facts: list[FactSeed] = Field(default_factory=list)
    opening: OpeningBrief = Field(default_factory=OpeningBrief)

    _characters = field_validator("characters", mode="before")(_clip_list(12))
    _locations = field_validator("locations", mode="before")(_clip_list(12))
    _items = field_validator("items", mode="before")(_clip_list(16))
    _orgs = field_validator("organizations", mode="before")(_clip_list(8))
    _facts = field_validator("facts", mode="before")(_clip_list(40))


def _clamp_importance(value: Any) -> Any:
    if isinstance(value, bool):
        return 3
    if isinstance(value, int | float):
        return max(1, min(5, int(value)))
    return value


def _dedupe[T: BaseModel](items: list[T], key: Callable[[T], str]) -> list[T]:
    seen: set[str] = set()
    result: list[T] = []
    for item in items:
        norm = key(item)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        result.append(item)
    return result


def normalize_seed(seed: Seed, *, protagonist_name: str, card_name: str) -> Seed:
    """校正模型产出的 Seed：

    - 主角名以玩家输入为准，NPC 里与主角同名的去掉；
    - 同类实体按名字去重，名字为空的丢弃；
    - 角色卡的主角色必须在 NPC 里（模型漏了就补上）；
    - 引用（在场人物、持有者、所在地点、成员、事实涉及的实体）只保留能解析到的名字。
    """
    protagonist_name = clean_display_name(protagonist_name)
    protagonist = seed.protagonist.model_copy(update={"name": protagonist_name})
    hero = normalize_name(protagonist_name)

    def norm(model: Any) -> str:
        return normalize_name(model.name)

    characters = _dedupe([c for c in seed.characters if norm(c) != hero], norm)
    card_norm = normalize_name(card_name) if card_name else ""
    if card_norm and card_norm != hero and card_norm not in {norm(c) for c in characters}:
        characters.insert(0, CharacterSeed(name=card_name, importance=5))
    locations = _dedupe(seed.locations, norm)
    items = _dedupe(seed.items, norm)
    orgs = _dedupe(seed.organizations, norm)

    people = {norm(c): c.name for c in characters}
    people[hero] = protagonist_name
    places = {norm(loc): loc.name for loc in locations}
    everything: dict[str, str] = {**places, **people}
    everything.update({norm(i): i.name for i in items})
    everything.update({norm(o): o.name for o in orgs})

    def resolve(name: str | None, pool: dict[str, str]) -> str | None:
        if not name:
            return None
        return pool.get(normalize_name(name))

    items = [
        item.model_copy(
            update={
                "holder": resolve(item.holder, people),
                "location": None
                if resolve(item.holder, people)
                else resolve(item.location, places),
            }
        )
        for item in items
    ]
    orgs = [
        org.model_copy(update={"members": [m for n in org.members if (m := resolve(n, people))]})
        for org in orgs
    ]
    facts = [
        fact.model_copy(
            update={
                "about": [m for n in fact.about if (m := resolve(n, everything))],
                "known_by": [m for n in fact.known_by if (m := resolve(n, people))],
            }
        )
        for fact in seed.facts
        if fact.text
    ]
    opening_location = resolve(seed.opening.location, places)
    present = [
        m
        for n in seed.opening.present
        if (m := resolve(n, people)) is not None and normalize_name(m) != hero
    ]
    opening = seed.opening.model_copy(
        update={"location": opening_location, "present": list(dict.fromkeys(present))}
    )
    return Seed(
        world=seed.world,
        protagonist=protagonist,
        characters=characters,
        locations=locations,
        items=items,
        organizations=orgs,
        facts=facts,
        opening=opening,
    )


def _first_paragraphs(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for mark in ("\n\n", "\n", "。", ".", "！", "？"):
        index = cut.rfind(mark)
        if index > limit // 2:
            return cut[: index + 1].strip()
    return cut.strip()


def minimal_seed(
    card: CharacterCard, *, protagonist_name: str, protagonist_summary: str = ""
) -> Seed:
    """WorldBuilder 失败或超时时的最小 Seed：只用角色卡原文，不调用模型。"""
    name = clean_display_name(protagonist_name)

    def text(value: str, limit: int) -> str:
        return _first_paragraphs(apply_macros(value, user=name, char=card.name), limit)

    character = CharacterSeed(
        name=card.name,
        summary=text("\n".join(p for p in (card.description, card.personality) if p), 500),
        speech_style=text(card.mes_example, 240),
        importance=5,
    )
    world = WorldSeed(title=card.name, setting=text(card.scenario or card.description, 800))
    opening = OpeningBrief(
        present=[card.name] if normalize_name(card.name) != normalize_name(name) else [],
        situation=text(card.first_mes or card.scenario, 500),
    )
    seed = Seed(
        world=world,
        protagonist=ProtagonistSeed(name=name, summary=protagonist_summary[:400]),
        characters=[character],
        opening=opening,
    )
    return normalize_seed(seed, protagonist_name=name, card_name=card.name)
