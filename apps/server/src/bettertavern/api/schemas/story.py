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
    created_at: datetime
    updated_at: datetime
    duplicate: bool = False


class ScenarioPatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


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
