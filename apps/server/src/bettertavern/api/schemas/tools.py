"""外部服务（搜索、读网页、文生图）的配置。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .common import Out


class ToolProviderOut(Out):
    id: str
    kinds: list[str]
    can_search: bool
    can_images: bool
    can_fetch: bool
    needs_key: bool
    needs_base_url: bool
    needs_model: bool
    max_references: int


class ToolRouteIn(BaseModel):
    kind: Literal["search", "fetch", "image"]
    provider: str = Field(max_length=40)
    label: str = Field(default="", max_length=60)
    api_key: str | None = Field(default=None, max_length=4096)
    base_url: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=200)
    params: dict[str, Any] = Field(default_factory=dict)
    # 设为这一种的默认（第一次添加的那种自动是默认）
    default: bool = False


class ToolRoutePatchIn(BaseModel):
    label: str | None = Field(default=None, max_length=60)
    # 不传或空串表示不改 Key
    api_key: str | None = Field(default=None, max_length=4096)
    # 传空串表示清空地址
    base_url: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=200)
    params: dict[str, Any] | None = None
    default: bool | None = None


class ToolRouteOut(Out):
    id: str
    kind: str
    provider: str
    label: str
    base_url: str | None
    key_last4: str
    has_key: bool
    model: str | None
    params: dict[str, Any]
    status: str
    probe: dict[str, Any]
    is_default: bool
    created_at: datetime
    updated_at: datetime
