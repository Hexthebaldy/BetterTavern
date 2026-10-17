"""剧本、游玩、回合与世界视图。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .common import Out


class ScenarioOut(Out):
    id: str
    name: str
    source_kind: str
    avatar_blob_id: str | None
    description_preview: str
    first_mes_preview: str
    creator: str
    tags: list[str]
    book_entries: int
    alternate_greetings: int
    truncated_fields: list[str]
    version: int
    edited_at: datetime | None
    created_at: datetime
    updated_at: datetime
    duplicate: bool = False


class ScenarioPatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


# 编辑角色卡：长度上限由 domain/scenario/edit.py 检查（超长时返回带 field 的 422），这里不重复限制；
# 请求体整体不超过 4 MB（见 api/v1/scenarios.py 的 MAX_CARD_BODY_BYTES）


class LoreEntryIn(BaseModel):
    name: str = ""
    keys: list[str] = Field(default_factory=list)
    content: str = ""
    enabled: bool = True
    constant: bool = False


class CharacterCardIn(BaseModel):
    name: str
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""
    tags: list[str] = Field(default_factory=list)
    book: list[LoreEntryIn] = Field(default_factory=list)


class ScenarioCardIn(BaseModel):
    version: int = Field(ge=1)
    display_name: str
    card: CharacterCardIn


class LoreEntryOut(Out):
    name: str
    keys: list[str]
    content: str
    enabled: bool
    constant: bool


class CharacterCardOut(Out):
    name: str
    description: str
    personality: str
    scenario: str
    first_mes: str
    mes_example: str
    tags: list[str]
    book: list[LoreEntryOut]


class ScenarioCardOut(Out):
    scenario_id: str
    version: int
    edited_at: datetime | None
    display_name: str
    card: CharacterCardOut
    truncated_fields: list[str]


class ProtagonistIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    summary: str = Field(default="", max_length=400)


class PreferencesIn(BaseModel):
    length: Literal["short", "medium", "long"] = "medium"
    style: str = Field(default="", max_length=200)
    boundaries: str = Field(default="", max_length=300)


class PlaythroughIn(BaseModel):
    scenario_id: str
    protagonist: ProtagonistIn
    title: str | None = Field(default=None, max_length=80)
    preferences: PreferencesIn = Field(default_factory=PreferencesIn)


class PlaythroughPatchIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class OptionOut(BaseModel):
    id: str
    text: str


class TurnOut(Out):
    id: str
    playthrough_id: str
    seq: int
    attempt: int
    status: str
    action: dict[str, Any]
    narrative: str
    options: list[OptionOut]
    options_source: str | None
    state_lag: bool
    error: dict[str, Any] | None
    created_at: datetime
    replied_at: datetime | None


class PlaythroughOut(Out):
    id: str
    title: str
    status: str
    scenario_id: str | None
    protagonist_name: str
    preferences: dict[str, Any]
    head_turn_id: str | None
    head_seq: int | None
    head_excerpt: str
    active_turn_id: str | None
    rollback_floor_seq: int
    seed_source: str | None
    created_at: datetime
    updated_at: datetime


class PlaythroughDetailOut(Out):
    playthrough: PlaythroughOut
    head: TurnOut | None
    active_turn: TurnOut | None
    last_failed: TurnOut | None


class PlaythroughCreatedOut(BaseModel):
    playthrough: PlaythroughOut
    turn: TurnOut
    events_url: str


class ActionIn(BaseModel):
    source: Literal["option", "text", "opening", "ending"]
    text: str | None = Field(default=None, max_length=4000)
    option_id: str | None = Field(default=None, max_length=8)


class TurnIn(BaseModel):
    parent_turn_id: str | None = None
    action: ActionIn


class TurnCreatedOut(BaseModel):
    turn: TurnOut
    events_url: str


class TurnListOut(BaseModel):
    turns: list[TurnOut]


class WorldEntityOut(Out):
    id: str
    kind: str
    name: str
    aliases: list[str]
    summary: str
    data: dict[str, Any]
    importance: int
    is_protagonist: bool


class WorldFactOut(Out):
    id: str
    text: str
    entity_ids: list[str]
    importance: int
    secret: bool


class WorldOut(Out):
    entities: list[WorldEntityOut]
    links: list[dict[str, str]]
    facts: list[WorldFactOut]
    hidden_facts: int
