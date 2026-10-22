"""剧本、游玩、回合与世界视图。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from bettertavern.domain.story.language import DEFAULT_LANGUAGE, PromptLanguage

from .common import Out


class ProtagonistIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    summary: str = Field(default="", max_length=400)


class PreferencesIn(BaseModel):
    length: Literal["short", "medium", "long"] = "medium"
    style: str = Field(default="", max_length=200)
    boundaries: str = Field(default="", max_length=300)


class PlaythroughIn(BaseModel):
    scenario_id: str
    # 不传时用剧本设置（scenarios.setup）里的默认主角和偏好
    protagonist: ProtagonistIn | None = None
    title: str | None = Field(default=None, max_length=80)
    preferences: PreferencesIn | None = None
    # 这一局给 agent 的提示词用哪种语言：客户端传当前的界面语言；之后不变
    language: PromptLanguage = DEFAULT_LANGUAGE


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
    state_seq: int
    error: dict[str, Any] | None
    created_at: datetime
    replied_at: datetime | None


class PlaythroughOut(Out):
    id: str
    title: str
    status: str
    scenario_id: str | None
    language: str
    protagonist_name: str
    preferences: dict[str, Any]
    head_turn_id: str | None
    head_seq: int | None
    head_excerpt: str
    active_turn_id: str | None
    state_seq: int
    rollbacks_left: int
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


class RollbackIn(BaseModel):
    turn_id: str = Field(max_length=64)


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
    is_protagonist: bool


class WorldFactOut(Out):
    id: str
    text: str
    entity_ids: list[str]
    secret: bool


class WorldStateIssueOut(Out):
    seq: int
    kind: Literal["failed", "skipped"]
    reason: str | None


class WorldOut(Out):
    entities: list[WorldEntityOut]
    links: list[dict[str, str]]
    facts: list[WorldFactOut]
    hidden_facts: int
    state_seq: int
    state_issue: WorldStateIssueOut | None
