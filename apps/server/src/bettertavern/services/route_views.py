"""模型路由给接口看的样子：RouteView、窗口说明、服务商列表。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bettertavern.domain.memory.thresholds import WindowCheck
from bettertavern.domain.routing import RouteTask
from bettertavern.infra.db.repositories.routes import RouteRow
from bettertavern.runtime.routing import window_for

from . import route_inputs as inp
from .errors import AppError
from .route_codec import RouteCodec


@dataclass(frozen=True, slots=True)
class ProviderInfo:
    id: str
    display_name: str
    default_base_url: str | None
    requires_base_url: bool


@dataclass(frozen=True, slots=True)
class WindowInfo:
    model_window: int
    # listed / table / manual / learned / default，见 RouteCodec.model_window()
    source: str
    working_cap: int
    max_tokens: int
    effective_window: int
    warnings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RouteView:
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
    last_probe: dict[str, Any] | None
    is_director: bool
    is_background: bool
    is_workbench: bool
    # 能不能调用工具：不能的模型不能用于后台整理（世界状态 agent 靠工具改世界状态）
    supports_tools: bool
    shares_key_with: list[str]
    window: WindowInfo
    created_at: datetime
    updated_at: datetime


def too_small(check: WindowCheck) -> AppError:
    return AppError(
        "The effective window is too small: use a model with a larger window, "
        "raise the working window limit or lower the max output",
        code="WINDOW_TOO_SMALL",
        status=422,
        model_window=check.model_window,
        cap=check.working_cap,
        max_tokens=check.reserved_output,
        effective_window=check.effective_window,
    )


def _view(codec: RouteCodec, row: RouteRow, shares_key_with: list[str]) -> RouteView:
    params = inp.parse_params(row.params)
    check = window_for(codec.caps(row), params, RouteTask.DIRECTOR)
    header_names: list[str] = []
    if row.extra_headers_enc:
        try:
            header_names = sorted(codec.headers(row))
        except AppError:
            header_names = []
    report = row.probe.get("report")
    return RouteView(
        id=row.id,
        label=row.label,
        provider=row.provider,
        model=row.model,
        base_url=row.base_url,
        key_last4=row.key_last4,
        extra_header_names=header_names,
        extra_body=row.extra_body,
        manual_window=row.manual_window,
        params=params.model_dump(exclude_none=True),
        caps_override=row.caps_override,
        status=row.status,
        last_ok_at=row.last_ok_at,
        last_probe=report if isinstance(report, dict) else None,
        is_director=row.is_director,
        is_background=row.is_background,
        is_workbench=row.is_workbench,
        supports_tools=codec.caps(row).tools,
        shares_key_with=shares_key_with,
        window=WindowInfo(
            model_window=check.model_window,
            source=codec.model_window(row)[1],
            working_cap=check.working_cap,
            max_tokens=check.reserved_output,
            effective_window=check.effective_window,
            warnings=check.warnings,
        ),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def build_views(
    codec: RouteCodec, rows: list[RouteRow], only: str | None = None
) -> list[RouteView]:
    """rows 是这个用户的全部模型（要靠它们算出谁和谁共用一个 Key）；only 只要其中一行。"""
    prints = codec.fingerprints(rows)
    views = []
    for row in rows:
        if only is not None and row.id != only:
            continue
        mine = prints[row.id]
        shared = [
            other.id
            for other in rows
            if other.id != row.id and mine is not None and prints[other.id] == mine
        ]
        views.append(_view(codec, row, shared))
    return views
