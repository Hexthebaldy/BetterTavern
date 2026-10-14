"""模型路由：保存时校验窗口设置能否被模型满足；运行时解析出凭据、模型、能力与有效窗口。

窗口校验的算法只在 domain/memory/thresholds.py 的 effective_window() 里，保存路由与每次调用前共用。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.memory.thresholds import WindowCheck
from bettertavern.domain.routing import RouteParams, RouteTask
from bettertavern.infra.db.repositories import credentials as repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.providers import Capabilities
from bettertavern.runtime.routing import ResolvedRoute, window_for

from .credential_service import CredentialService
from .errors import AppError, Invalid, NotFound


@dataclass(frozen=True, slots=True)
class WindowInfo:
    model_window: int
    working_cap: int
    max_tokens: int
    effective_window: int
    warnings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RouteView:
    id: str
    task: str
    credential_id: str
    provider: str
    credential_label: str
    model: str
    params: dict[str, Any]
    caps_override: dict[str, Any]
    fallback_route_id: str | None
    window: WindowInfo
    updated_at: datetime


def _window_info(check: WindowCheck) -> WindowInfo:
    return WindowInfo(
        model_window=check.model_window,
        working_cap=check.working_cap,
        max_tokens=check.reserved_output,
        effective_window=check.effective_window,
        warnings=check.warnings,
    )


def parse_params(data: Mapping[str, Any] | None) -> RouteParams:
    try:
        return RouteParams.model_validate(dict(data or {}))
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first.get("loc", ()))
        raise Invalid(
            f"路由参数不合法：{field} {first.get('msg', '')}", field=f"params.{field}"
        ) from exc


def parse_task(task: str) -> RouteTask:
    try:
        return RouteTask(task)
    except ValueError:
        raise NotFound(f"未知的路由用途：{task}") from None


class RouteService:
    def __init__(self, engine: AsyncEngine, credentials: CredentialService) -> None:
        self._engine = engine
        self._credentials = credentials

    async def _view(self, route: repo.RouteRow, cred: repo.CredentialRow) -> RouteView:
        task = RouteTask(route.task)
        params = parse_params(route.params)
        caps = self._credentials.capabilities(cred, route.model, route.caps_override)
        return RouteView(
            id=route.id,
            task=route.task,
            credential_id=cred.id,
            provider=cred.provider,
            credential_label=cred.label,
            model=route.model,
            params=params.model_dump(exclude_none=True),
            caps_override=route.caps_override,
            fallback_route_id=route.fallback_route_id,
            window=_window_info(window_for(caps, params, task)),
            updated_at=route.updated_at,
        )

    async def list(self, user_id: str) -> list[RouteView]:
        async with self._engine.connect() as conn:
            routes = await repo.list_user_routes(conn, user_id)
            creds = {c.id: c for c in await repo.list_credentials(conn, user_id)}
        return [
            await self._view(r, creds[r.credential_id]) for r in routes if r.credential_id in creds
        ]

    async def put(
        self,
        user_id: str,
        task_name: str,
        *,
        credential_id: str,
        model: str,
        params: Mapping[str, Any] | None,
        caps_override: Mapping[str, Any] | None,
        fallback_route_id: str | None,
    ) -> RouteView:
        task = parse_task(task_name)
        model = model.strip()
        if not model or len(model) > 200:
            raise Invalid("请填写模型名", field="model")
        parsed = parse_params(params)
        override = dict(caps_override or {})
        if override:
            try:
                Capabilities.from_mapping(override)
            except ValueError as exc:
                raise Invalid(f"能力覆盖不合法：{exc}", field="caps_override") from exc
        async with self._engine.begin() as conn:
            cred = (
                await repo.get_credential(conn, user_id, credential_id)
                if is_uuid(credential_id)
                else None
            )
            if cred is None:
                raise NotFound("凭据不存在")
            if fallback_route_id is not None:
                fallback = (
                    await repo.get_route(conn, user_id, fallback_route_id)
                    if is_uuid(fallback_route_id)
                    else None
                )
                if fallback is None:
                    raise NotFound("备用路由不存在")
                if fallback.task == task.value and fallback.playthrough_id is None:
                    raise Invalid("备用路由不能是它自己", field="fallback_route_id")
            caps = self._credentials.capabilities(cred, model, override)
            check = window_for(caps, parsed, task)
            if check.too_small:
                raise AppError(
                    "有效窗口太小：请换更大窗口的模型、调大工作窗口上限或调小最大输出",
                    code="WINDOW_TOO_SMALL",
                    status=422,
                    model_window=check.model_window,
                    cap=check.working_cap,
                    max_tokens=check.reserved_output,
                    effective_window=check.effective_window,
                )
            route = await repo.upsert_user_route(
                conn,
                user_id=user_id,
                task=task.value,
                credential_id=cred.id,
                model=model,
                params=parsed.model_dump(exclude_none=True),
                caps_override=override,
                fallback_route_id=fallback_route_id,
            )
        return await self._view(route, cred)

    async def delete(self, user_id: str, task_name: str) -> None:
        task = parse_task(task_name)
        async with self._engine.begin() as conn:
            if not await repo.delete_user_route(conn, user_id, task.value):
                raise NotFound("这个用途没有配置路由")

    # ---- 运行时解析 ----------------------------------------------------------------------
    async def resolve(
        self, user_id: str, task: RouteTask, playthrough_id: str | None = None
    ) -> ResolvedRoute | None:
        async with self._engine.connect() as conn:
            route = await repo.find_route(conn, user_id, task.value, playthrough_id)
            if route is None and task is not RouteTask.DIRECTOR:
                route = await repo.find_route(
                    conn, user_id, RouteTask.DIRECTOR.value, playthrough_id
                )
            if route is None:
                return None
            cred = await repo.get_credential(conn, user_id, route.credential_id)
            fallback_pair: tuple[repo.RouteRow, repo.CredentialRow] | None = None
            if route.fallback_route_id:
                fb = await repo.get_route(conn, user_id, route.fallback_route_id)
                fb_cred = await repo.get_credential(conn, user_id, fb.credential_id) if fb else None
                if fb is not None and fb_cred is not None:
                    fallback_pair = (fb, fb_cred)
        if cred is None:
            return None
        fallback = (
            self._resolved(fallback_pair[0], fallback_pair[1], task) if fallback_pair else None
        )
        return self._resolved(route, cred, task, fallback)

    def _resolved(
        self,
        route: repo.RouteRow,
        cred: repo.CredentialRow,
        task: RouteTask,
        fallback: ResolvedRoute | None = None,
    ) -> ResolvedRoute:
        params = parse_params(route.params)
        caps = self._credentials.capabilities(cred, route.model, route.caps_override)
        return ResolvedRoute(
            route_id=route.id,
            task=task,
            provider=cred.provider,
            model=route.model,
            credential=self._credentials.resolve_row(cred),
            caps=caps,
            params=params,
            window=window_for(caps, params, task),
            fallback=fallback,
        )
