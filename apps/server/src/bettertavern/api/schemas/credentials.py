"""服务商、凭据、探测与模型路由。"""

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


class CredentialIn(BaseModel):
    provider: str = Field(max_length=40)
    label: str = Field(default="", max_length=60)
    api_key: str = Field(min_length=1, max_length=4096)
    base_url: str | None = Field(default=None, max_length=500)
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None


class CredentialPatchIn(BaseModel):
    label: str | None = Field(default=None, max_length=60)
    api_key: str | None = Field(default=None, max_length=4096)
    # 传空字符串表示恢复为服务商的默认地址
    base_url: str | None = Field(default=None, max_length=500)
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None


class ProbedModelOut(Out):
    model: str
    probed_at: str
    ok: bool
    fatal_error: str | None
    checks: list[dict[str, Any]]


class CredentialOut(Out):
    id: str
    provider: str
    label: str
    base_url: str | None
    key_last4: str
    extra_header_names: list[str]
    extra_body: dict[str, Any]
    status: str
    last_ok_at: datetime | None
    probed_models: list[ProbedModelOut]
    created_at: datetime
    updated_at: datetime


class ProbeIn(BaseModel):
    model: str = Field(min_length=1, max_length=200)


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


class ModelOut(Out):
    id: str
    context_window: int | None
    owned_by: str | None


class RouteParamsIn(BaseModel):
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    thinking: bool = False
    working_window: int | None = None


class RouteIn(BaseModel):
    credential_id: str
    model: str = Field(min_length=1, max_length=200)
    params: RouteParamsIn = Field(default_factory=RouteParamsIn)
    caps_override: dict[str, Any] = Field(default_factory=dict)
    fallback_route_id: str | None = None


class WindowOut(Out):
    model_window: int
    working_cap: int
    max_tokens: int
    effective_window: int
    warnings: list[str]


class RouteOut(Out):
    id: str
    task: str
    credential_id: str
    provider: str
    credential_label: str
    model: str
    params: dict[str, Any]
    caps_override: dict[str, Any]
    fallback_route_id: str | None
    window: WindowOut
    updated_at: datetime
