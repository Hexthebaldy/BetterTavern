"""角色卡仓库与剧本仓库。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .common import Out

# ---- 卡片内容（角色卡详情、草稿共用） ----


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
    system_prompt: str
    creator_notes: str
    alternate_greetings: list[str]
    tags: list[str]
    book: list[LoreEntryOut]
    # 下面几项不能在 BetterTavern 里改，原样保留、导出时写回去
    creator: str
    character_version: str
    post_history_instructions: str
    truncated: list[str]


# 编辑卡片：长度上限由 domain/scenario/edit.py 检查（超长时返回带 field 的 422），这里不重复限制；
# 请求体整体不超过 4 MB（见 api/v1/workbench.py 的 MAX_CARD_BODY_BYTES）


class LoreEntryIn(BaseModel):
    name: str = ""
    keys: list[str] = Field(default_factory=list)
    content: str = ""
    enabled: bool = True
    constant: bool = False


class CharacterCardIn(BaseModel):
    name: str = ""
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""
    system_prompt: str = ""
    creator_notes: str = ""
    alternate_greetings: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    book: list[LoreEntryIn] = Field(default_factory=list)


# ---- 角色卡仓库 ----


class CardIpOut(BaseModel):
    work: str = ""
    character: str = ""


class CardOut(Out):
    id: str
    name: str
    character_name: str
    source: str
    cover_blob_id: str | None
    description_preview: str
    creator: str
    tags: list[str]
    book_entries: int
    greetings: int
    made_by: str
    ip: CardIpOut | None
    scenario_count: int
    draft_id: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class ScenarioRefOut(BaseModel):
    id: str
    name: str


class CardSourceOut(BaseModel):
    url: str
    title: str = ""
    used_in: list[str] = Field(default_factory=list)


class CardDetailOut(BaseModel):
    card: CardOut
    content: CharacterCardOut
    sources: list[CardSourceOut]
    scenarios: list[ScenarioRefOut]


class CardRevisionOut(Out):
    version: int
    name: str
    note: str
    cover_blob_id: str | None
    from_draft: bool
    created_at: datetime


# ---- 剧本仓库 ----


class SetupProtagonist(BaseModel):
    name: str = Field(default="", max_length=40)
    summary: str = Field(default="", max_length=400)


class SetupPreferences(BaseModel):
    length: Literal["short", "medium", "long"] = "medium"
    style: str = Field(default="", max_length=200)
    boundaries: str = Field(default="", max_length=300)


class SetupOpening(BaseModel):
    card_id: str
    greeting: int = Field(default=0, ge=0, le=64)


class ScenarioSetupModel(BaseModel):
    protagonist: SetupProtagonist = Field(default_factory=SetupProtagonist)
    preferences: SetupPreferences = Field(default_factory=SetupPreferences)
    # 用哪张卡的哪条开场白；为空时由导演写开场
    opening: SetupOpening | None = None
    # 闪电模式：这个剧本开的新故事更省、没有世界状态（只影响之后开始的故事）
    lightning: bool = False


class ScenarioCardOut(Out):
    card_id: str
    name: str
    cover_blob_id: str | None


class ScenarioOut(Out):
    id: str
    name: str
    cards: list[ScenarioCardOut]
    cover_blob_id: str | None
    setup: ScenarioSetupModel
    description_preview: str
    version: int
    created_at: datetime
    updated_at: datetime


class ScenarioIn(BaseModel):
    # 不传时用第一张卡的名字
    name: str | None = Field(default=None, max_length=80)
    card_ids: list[str] = Field(min_length=1, max_length=8)
    setup: ScenarioSetupModel = Field(default_factory=ScenarioSetupModel)


class ScenarioPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    card_ids: list[str] | None = Field(default=None, min_length=1, max_length=8)
    setup: ScenarioSetupModel | None = None
    # 带上读到的版本号时检查有没有在别处改过（409 SCENARIO_CHANGED）
    version: int | None = Field(default=None, ge=1)


def setup_json(setup: ScenarioSetupModel) -> dict[str, Any]:
    return setup.model_dump(mode="json")
