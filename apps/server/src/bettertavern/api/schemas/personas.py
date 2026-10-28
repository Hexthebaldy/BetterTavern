"""人设库（F3，docs/personas.md）。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .common import Out


class PersonaOut(Out):
    id: str
    name: str
    description: str
    # 头像（正方形）；没有时客户端画名字的第一个字
    avatar_blob_id: str | None
    is_default: bool
    # 几个剧本选了它当默认人设
    scenario_count: int
    created_at: datetime
    updated_at: datetime


# 长度上限由 domain/scenario/persona.py 检查（超长时返回带 field 的 422），这里只防特别大的请求
class PersonaIn(BaseModel):
    name: str = Field(max_length=200)
    description: str = Field(default="", max_length=8000)
    is_default: bool = False


class PersonaPatchIn(BaseModel):
    # 不传的项不改
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    is_default: bool | None = None


class PersonaImportOut(BaseModel):
    # 导入以后人设库里的全部人设
    personas: list[PersonaOut]
    created: int
    # 和已有的一模一样、没有名字、超过上限没导进来的
    skipped: int
