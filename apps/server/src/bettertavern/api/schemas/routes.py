"""服务商、模型列表、模型路由（玩家配好的模型）与测试结果。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from .common import Out


class ProviderOut(Out):
    id: str
    display_name: str
    default_base_url: str | None
    requires_base_url: bool


class ModelListIn(BaseModel):
    api_key: str | None = Field(default=None, max_length=4096)
    copy_key_from: str | None = None
    base_url: str | None = Field(default=None, max_length=500)


class ModelOut(Out):
    id: str
    context_window: int | None
    window_source: str | None
    owned_by: str | None


class RouteParamsIn(BaseModel):
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    thinking: bool = False
    working_window: int | None = None


class RouteIn(BaseModel):
    provider: str = Field(max_length=40)
    model: str = Field(min_length=1, max_length=200)
    label: str = Field(default="", max_length=60)
    api_key: str | None = Field(default=None, max_length=4096)
    copy_key_from: str | None = None
    base_url: str | None = Field(default=None, max_length=500)
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None
    manual_window: int | None = None
    params: RouteParamsIn = Field(default_factory=RouteParamsIn)
    caps_override: dict[str, Any] = Field(default_factory=dict)
    director: bool = False
    background: bool = False


class RoutePatchIn(BaseModel):
    label: str | None = Field(default=None, max_length=60)
    model: str | None = Field(default=None, max_length=200)
    api_key: str | None = Field(default=None, max_length=4096)
    apply_to_same_key: bool = False
    # 传空字符串表示恢复为服务商的默认地址
    base_url: str | None = Field(default=None, max_length=500)
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None
    # 传 null 表示清空手填的窗口；不传表示不改
    manual_window: int | None = None
    params: RouteParamsIn | None = None
    caps_override: dict[str, Any] | None = None
    director: bool | None = None
    background: bool | None = None


class ProbeCheckOut(BaseModel):
    name: str
    ok: bool | None
    detail: str
    latency_ms: int | None


class ProbeOut(BaseModel):
    provider: str
    model: str
    probed_at: str
    fatal_error: str | None
    checks: list[ProbeCheckOut]
    caps_overlay: dict[str, Any]


class WindowOut(Out):
    model_window: int
    source: str
    working_cap: int
    max_tokens: int
    effective_window: int
    warnings: list[str]


class RouteOut(Out):
    id: str
    label: str
    provider: str
    model: str
    base_url: str | None
    key_last4: str
    extra_header_names: list[str]
    extra_body: dict[str, Any]
    manual_window: int | None
    params: dict[str, Any]
    caps_override: dict[str, Any]
    status: str
    last_ok_at: datetime | None
    last_probe: ProbeOut | None
    is_director: bool
    is_background: bool
    supports_tools: bool
    shares_key_with: list[str]
    window: WindowOut
    created_at: datetime
    updated_at: datetime
