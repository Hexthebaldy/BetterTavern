"""世界书仓库（docs/lorebook.md）。条目的结构和卡里的世界书共用
（library.py 的 LoreEntryOut、LoreEntryIn）。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .common import Out
from .library import LoreEntryIn, LoreEntryOut, ScenarioRefOut


class LorebookReportOut(BaseModel):
    entries: int = 0
    constant: int = 0
    disabled: int = 0
    dropped_empty: int = 0
    dropped_unreachable: int = 0
    dropped_over_limit: int = 0
    vectorized: int = 0
    character_filter: int = 0
    bad_regex: int = 0
    other_macros: int = 0


class LorebookOut(Out):
    id: str
    name: str
    description: str
    source: str
    entries: int
    constant: int
    scenario_count: int
    # 新建的是 null（没有导入报告）
    report: LorebookReportOut | None
    version: int
    created_at: datetime
    updated_at: datetime


class LorebookDetailOut(BaseModel):
    lorebook: LorebookOut
    book: list[LoreEntryOut]
    scenarios: list[ScenarioRefOut]


class LorebookImportOut(BaseModel):
    # 导入成功时是新的那本；同一个文件导入过、又没让另起一份时为 null，existing 是已有的那本
    lorebook: LorebookDetailOut | None
    existing: LorebookOut | None


# 名字、简介的长度由用例层检查（422 带 field），这里不重复限制


class LorebookCreateIn(BaseModel):
    name: str
    description: str = ""


class LorebookPatchIn(BaseModel):
    name: str | None = None
    description: str | None = None
    # 带上读到的版本号时检查有没有在别处改过（409 LOREBOOK_CHANGED）
    version: int | None = Field(default=None, ge=1)


class LorebookBookIn(BaseModel):
    """编辑条目的自动保存：整本的条目和读到的版本号；上限由 domain/scenario/lorebook.py 检查。"""

    version: int = Field(ge=1)
    book: list[LoreEntryIn] = Field(default_factory=list)
