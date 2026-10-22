"""工作台：草稿、图片、保存到角色卡仓库。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from bettertavern.domain.story.language import DEFAULT_LANGUAGE, PromptLanguage

from .common import Out
from .library import CardOut, CharacterCardIn, CharacterCardOut, ScenarioOut


class DraftCreateIn(BaseModel):
    origin: Literal["manual", "edit_card", "agent"]
    # origin = edit_card 时必填：从仓库打开哪张卡
    card_id: str | None = None
    # origin = agent 时必填：用户在聊天框里说的第一句话
    text: str | None = Field(default=None, max_length=8000)
    # 草稿的语言（agent 说话和提示词用）：客户端传当前的界面语言
    language: PromptLanguage = DEFAULT_LANGUAGE


class DraftCardIn(BaseModel):
    version: int = Field(ge=1)
    name: str = Field(default="", max_length=200)
    card: CharacterCardIn


class DraftPatchIn(BaseModel):
    mode: Literal["agent", "manual"]


class DraftCoverIn(BaseModel):
    asset_id: str | None
    # 版权不明的图要确认“仅限个人使用”才能当封面（否则 409 IMAGE_LICENSE）
    personal_use: bool = False


class DraftSaveIn(BaseModel):
    # 顺便用这张卡建一个剧本（“保存并开始新故事”）
    new_scenario: bool = False
    # 卡在别处改过（409 CARD_CHANGED）以后，用户的选择：覆盖，或者另存成新卡
    on_conflict: Literal["overwrite", "copy"] | None = None


class IssueOut(Out):
    field: str
    code: str
    level: Literal["error", "warning"]
    params: dict[str, Any]


class AssetOut(Out):
    id: str
    blob_id: str
    source: str
    license: str
    source_url: str | None
    prompt: str | None
    mime: str
    width: int | None
    height: int | None
    personal_use: bool
    created_at: datetime


class NoteOut(Out):
    id: str
    text: str
    url: str
    title: str
    site: str
    used_in: list[str]


class CoverGenerateIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    # ink（水墨）、oil（油画）、film（胶片）、flat（平涂）之一，或者自己写；拼进提示词
    style: str = Field(default="", max_length=40)
    count: int = Field(default=4, ge=1, le=4)
    aspect: Literal["portrait", "square", "landscape"] = "portrait"


class DraftSummaryOut(Out):
    id: str
    name: str
    character_name: str
    origin: str
    card_id: str | None
    cover_blob_id: str | None
    mode: str
    stage: str
    agent_status: str
    awaiting: dict[str, Any] | None
    version: int
    saved_version: int | None
    unsaved: bool
    created_at: datetime
    updated_at: datetime


class DraftOut(BaseModel):
    draft: DraftSummaryOut
    card: CharacterCardOut
    cover_asset_id: str | None
    base_version: int | None
    todos: list[dict[str, Any]]
    language: str
    issues: list[IssueOut]
    assets: list[AssetOut]
    notes: list[NoteOut]


class DraftImportOut(BaseModel):
    """导入一个文件：成功时是新草稿；这个文件已经导入过时 draft 为空，existing_card 是那张卡。"""

    draft: DraftOut | None
    existing_card: CardOut | None


class DraftSaveOut(BaseModel):
    card: CardOut
    draft: DraftOut
    scenario: ScenarioOut | None


class MessageIn(BaseModel):
    """说一句话（text）、交问卷（answers）、回复方案（plan_reply）。"""

    kind: Literal["text", "answers", "plan_reply"]
    text: str | None = Field(default=None, max_length=8000)
    # answers：键是问卷里的 qid；单选题是字符串，多选题是字符串数组；没答的题按推荐项
    answers: dict[str, Any] | None = None
    # answers：“都交给你”
    delegated: bool = False
    # plan_reply：确认（approved 为真，name 是选中的名字）或退回（approved 为假，text 写想改哪里）
    approved: bool | None = None
    name: str | None = Field(default=None, max_length=80)


class MessageOut(Out):
    seq: int
    role: str
    kind: str
    content: dict[str, Any]
    created_at: datetime


class TranscriptOut(BaseModel):
    messages: list[MessageOut]
    last_event_id: int


class ChangesDecisionIn(BaseModel):
    accept: list[str] = Field(default_factory=list, max_length=50)
    reject: list[str] = Field(default_factory=list, max_length=50)
    # 全部采用（accept）或都不要（reject）；给了就不看 accept、reject
    all: Literal["accept", "reject"] | None = None


class ChangesDecisionOut(BaseModel):
    message: MessageOut
    draft: DraftOut


class StopOut(BaseModel):
    stopped: bool
