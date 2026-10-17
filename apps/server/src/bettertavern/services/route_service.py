"""模型路由：玩家配好的模型（Key、端点、模型名、窗口、写法设置），其中一个是导演。

- Key 信封加密，接口只回后四位；只在请求前解密，用完不缓存明文（解密和窗口计算在 route_codec.py）；
- 自定义端点创建和修改时做 SSRF 校验（请求时 SafeTransport 还会再校验一次）；
- 保存时用服务商的模型列表确定上下文窗口（列表缓存见 route_models.py）；
  运行中服务商报超长并写明上限时记进 learned_window，只会往小调；
- 搭建世界、补选项等其他 task 都用导演这一行的模型。

窗口校验的算法只在 domain/memory/thresholds.py 的 effective_window() 里，保存与每次调用前共用。
"""

from __future__ import annotations

import asyncio
import dataclasses
import time
import uuid
from datetime import datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.routing import RouteTask
from bettertavern.infra.crypto.keyring import Keyring
from bettertavern.infra.db.repositories import routes as repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.providers import (
    EndpointNotAllowed,
    EndpointPolicy,
    ModelInfo,
    ProbeReport,
    ProviderError,
    ProviderHub,
    ResolvedCredential,
    Secret,
    probe_model,
    validate_endpoint,
)
from bettertavern.providers.errors import ErrorClass
from bettertavern.runtime.routing import ResolvedRoute, window_for

from . import route_inputs as inp
from .errors import AppError, Invalid, NotFound
from .route_codec import RouteCodec
from .route_inputs import RouteInput, RoutePatch
from .route_models import ListedModel, ModelLister
from .route_views import ProviderInfo, RouteView, build_views, too_small

# Key、请求头的值都不进日志；端点只记主机名
log = structlog.get_logger(__name__)

# 保存时顺便拉模型列表确定窗口，最多等这么久；超时就当列表没给窗口
LIST_ON_SAVE_TIMEOUT_S = 15.0


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def _now() -> datetime:
    return datetime.now().astimezone()


class RouteService:
    def __init__(
        self, engine: AsyncEngine, keyring: Keyring, hub: ProviderHub, policy: EndpointPolicy
    ) -> None:
        self._engine = engine
        self._hub = hub
        self._policy = policy
        self._codec = RouteCodec(keyring, hub)
        self._lister = ModelLister(hub)

    # ---- 服务商与端点 ----------------------------------------------------------------------
    def providers(self) -> list[ProviderInfo]:
        return [
            ProviderInfo(
                id=p.id,
                display_name=p.display_name,
                default_base_url=p.default_base_url,
                requires_base_url=p.requires_base_url,
            )
            for p in self._hub.registry.profiles()
        ]

    def _check_provider(self, provider: str) -> None:
        if provider not in self._hub.registry:
            raise Invalid(f"Unsupported provider: {provider}", field="provider")

    async def _check_endpoint(self, provider: str, base_url: str | None) -> str | None:
        profile = self._hub.registry.get(provider)
        url = (base_url or "").strip() or None
        if url is None:
            if profile.requires_base_url or not profile.default_base_url:
                raise Invalid(f"{profile.display_name} needs an endpoint URL", field="base_url")
            return None
        url = url.rstrip("/")
        if len(url) > 500:
            raise Invalid("The endpoint URL is too long", field="base_url")
        try:
            await validate_endpoint(url, self._policy)
        except EndpointNotAllowed as exc:
            raise AppError(
                f"Endpoint not allowed: {exc.reason}",
                code="ENDPOINT_NOT_ALLOWED",
                status=422,
                reason=exc.reason,
            ) from exc
        return url

    # ---- 读取 --------------------------------------------------------------------------
    async def list(self, user_id: str) -> list[RouteView]:
        async with self._engine.connect() as conn:
            rows = await repo.list_routes(conn, user_id)
        return build_views(self._codec, rows)

    async def _row(self, user_id: str, route_id: str) -> repo.RouteRow:
        if not is_uuid(route_id):
            raise NotFound("Model not found")
        async with self._engine.connect() as conn:
            row = await repo.get_route(conn, user_id, route_id)
        if row is None:
            raise NotFound("Model not found")
        return row

    async def get(self, user_id: str, route_id: str) -> RouteView:
        await self._row(user_id, route_id)
        async with self._engine.connect() as conn:
            rows = await repo.list_routes(conn, user_id)
        return build_views(self._codec, rows, only=route_id)[0]

    # ---- 模型列表 ------------------------------------------------------------------------
    async def _fetch_models(
        self, cred: ResolvedCredential, *, route_id: str | None
    ) -> list[ModelInfo]:
        started = time.perf_counter()
        try:
            models = await self._lister.fetch(cred)
        except ProviderError as exc:
            log.warning(
                "models.list_failed",
                route_id=route_id,
                provider=cred.provider,
                error_class=exc.error_class.value,
                status=exc.status,
                duration_ms=_elapsed_ms(started),
            )
            if exc.error_class is ErrorClass.AUTH:
                if route_id is not None:
                    async with self._engine.begin() as conn:
                        await repo.set_status(conn, route_id, status="invalid", ok=False)
                raise AppError(
                    "The provider rejected this key", code="CREDENTIAL_INVALID", status=424
                ) from exc
            raise AppError(
                f"Couldn't get the model list: {exc.message[:200]}",
                code="PROVIDER_ERROR",
                status=502,
                error_class=exc.error_class.value,
                retryable=exc.retryable,
            ) from exc
        log.info(
            "models.listed",
            route_id=route_id,
            provider=cred.provider,
            count=len(models),
            with_window=sum(1 for m in models if m.context_window),
            duration_ms=_elapsed_ms(started),
        )
        return models

    async def _source_key(
        self, user_id: str, provider: str, api_key: str | None, copy_key_from: str | None
    ) -> tuple[str, dict[str, str], str | None]:
        """新填的 Key，或者从自己另一个模型复制的 Key（连同它的自定义请求头和端点）。"""
        if api_key is not None and api_key.strip():
            return inp.clean_key(api_key), {}, None
        if copy_key_from is None:
            raise Invalid("Enter an API key", field="api_key")
        source = await self._row(user_id, copy_key_from)
        if source.provider != provider:
            raise Invalid("You can only reuse a key from the same provider", field="copy_key_from")
        return self._codec.key(source), self._codec.headers(source), source.base_url

    async def preview_models(
        self,
        user_id: str,
        provider: str,
        *,
        api_key: str | None,
        copy_key_from: str | None,
        base_url: str | None,
    ) -> list[ListedModel]:
        """用还没保存的 Key（或复用自己另一个模型的 Key）拉模型列表，添加模型的表单用。"""
        self._check_provider(provider)
        key, headers, inherited = await self._source_key(user_id, provider, api_key, copy_key_from)
        url = await self._check_endpoint(
            provider, base_url if base_url is not None or copy_key_from is None else inherited
        )
        cred = ResolvedCredential(
            credential_id=inp.key_fingerprint(provider, key),
            provider=provider,
            api_key=Secret(key),
            base_url=url,
            extra_headers=headers,
        )
        models = await self._fetch_models(cred, route_id=None)
        return self._lister.annotate(provider, models)

    async def list_models(self, user_id: str, route_id: str) -> list[ListedModel]:
        """用这个模型已存的 Key 重新拉列表（换模型名时用），顺便更新这个模型的窗口。"""
        row = await self._row(user_id, route_id)
        models = await self._fetch_models(self._codec.credential(row), route_id=row.id)
        window = self._lister.window_of(row.provider, models, row.model)
        async with self._engine.begin() as conn:
            await repo.set_status(
                conn,
                row.id,
                status="ok" if row.status != "ok" else None,
                ok=True,
                listed_window=window,
            )
        return self._lister.annotate(row.provider, models)

    async def _listed_window(self, cred: ResolvedCredential, model: str) -> tuple[int | None, bool]:
        """保存时确定服务商列表里的窗口：先看缓存，没有就拉一次（失败不影响保存）。

        返回（窗口，Key 是否已确认可用）。
        """
        models = self._lister.cached(cred)
        if models is None:
            try:
                async with asyncio.timeout(LIST_ON_SAVE_TIMEOUT_S):
                    models = await self._lister.fetch(cred)
            except (ProviderError, TimeoutError) as exc:
                reason = exc.error_class.value if isinstance(exc, ProviderError) else "timeout"
                log.info("models.list_skipped", provider=cred.provider, error_class=reason)
                return None, False
        return self._lister.window_of(cred.provider, models, model), True

    # ---- 写入 --------------------------------------------------------------------------
    async def create(self, user_id: str, data: RouteInput) -> RouteView:
        self._check_provider(data.provider)
        model = inp.clean_model(data.model)
        params = inp.parse_params(data.params)
        override = inp.clean_caps_override(data.caps_override)
        manual = None if data.manual_window is None else inp.clean_manual_window(data.manual_window)
        body = inp.clean_body(data.extra_body)
        key, copied_headers, inherited = await self._source_key(
            user_id, data.provider, data.api_key, data.copy_key_from
        )
        headers = (
            inp.clean_headers(data.extra_headers)
            if data.extra_headers is not None
            else copied_headers
        )
        base_url = await self._check_endpoint(
            data.provider,
            data.base_url if data.base_url is not None or data.copy_key_from is None else inherited,
        )
        cred = ResolvedCredential(
            credential_id=inp.key_fingerprint(data.provider, key),
            provider=data.provider,
            api_key=Secret(key),
            base_url=base_url,
            extra_headers=headers,
            extra_body=body,
        )
        listed, key_ok = await self._listed_window(cred, model)
        route_id = str(uuid.uuid4())
        api_key_enc, key_id = self._codec.seal_key(route_id, key)
        now = _now()
        row = repo.RouteRow(
            id=route_id,
            user_id=user_id,
            label=inp.clean_label(data.label),
            provider=data.provider,
            base_url=base_url,
            api_key_enc=api_key_enc,
            key_id=key_id,
            key_last4=inp.last4(key),
            extra_headers_enc=self._codec.seal_headers(route_id, headers),
            extra_body=body,
            model=model,
            listed_window=listed,
            manual_window=manual,
            learned_window=None,
            params=params.model_dump(exclude_none=True),
            caps_override=override,
            probe={},
            status="ok" if key_ok else "unverified",
            last_ok_at=now if key_ok else None,
            is_director=False,
            fallback_route_id=None,
            created_at=now,
            updated_at=now,
        )
        check = self._codec.check(row)
        if check.too_small:
            raise too_small(check)
        async with self._engine.begin() as conn:
            row = await repo.insert_route(conn, row)
            if data.director:
                await repo.set_director(conn, user_id, row.id)
        log.info(
            "route.created",
            route_id=row.id,
            provider=row.provider,
            model=row.model,
            endpoint_host=inp.endpoint_host(base_url),
            copied_key=data.copy_key_from is not None,
            window_source=self._codec.model_window(row)[1],
            director=data.director,
        )
        return await self.get(user_id, row.id)

    async def _apply(
        self, user_id: str, row: repo.RouteRow, patch: RoutePatch, changed: list[str]
    ) -> tuple[repo.RouteRow, str | None, bool]:
        """把 patch 应用到 row 上（还没写库）。返回（新行，新 Key，是否要重新确认 Key 和窗口）。"""
        new_key: str | None = None
        # 换了 Key、端点或模型：之前的测试结果不再可信
        reset = False
        if patch.label is not None:
            row = dataclasses.replace(row, label=inp.clean_label(patch.label))
            changed.append("label")
        if patch.api_key is not None and patch.api_key.strip():
            new_key = inp.clean_key(patch.api_key)
            enc, key_id = self._codec.seal_key(row.id, new_key)
            row = dataclasses.replace(
                row, api_key_enc=enc, key_id=key_id, key_last4=inp.last4(new_key)
            )
            reset = True
            changed.append("api_key")
        if patch.clear_base_url or patch.base_url is not None:
            url = await self._check_endpoint(
                row.provider, None if patch.clear_base_url else patch.base_url
            )
            if url != row.base_url:
                # 换了端点，列表给的窗口和学到的窗口都不再适用
                row = dataclasses.replace(
                    row, base_url=url, listed_window=None, learned_window=None
                )
                reset = True
            changed.append("base_url")
        if patch.model is not None:
            model = inp.clean_model(patch.model)
            if model != row.model:
                row = dataclasses.replace(row, model=model, listed_window=None, learned_window=None)
                reset = True
            changed.append("model")
        if patch.extra_headers is not None:
            headers = inp.clean_headers(patch.extra_headers)
            row = dataclasses.replace(
                row, extra_headers_enc=self._codec.seal_headers(row.id, headers)
            )
            changed.append("extra_headers")
        if patch.extra_body is not None:
            row = dataclasses.replace(row, extra_body=inp.clean_body(patch.extra_body))
            changed.append("extra_body")
        if patch.clear_manual_window:
            row = dataclasses.replace(row, manual_window=None)
            changed.append("manual_window")
        elif patch.manual_window is not None:
            manual = inp.clean_manual_window(patch.manual_window)
            row = dataclasses.replace(row, manual_window=manual)
            changed.append("manual_window")
        if patch.params is not None:
            params = inp.parse_params(patch.params)
            row = dataclasses.replace(row, params=params.model_dump(exclude_none=True))
            changed.append("params")
        if patch.caps_override is not None:
            override = inp.clean_caps_override(patch.caps_override)
            row = dataclasses.replace(row, caps_override=override)
            changed.append("caps_override")
        if patch.clear_fallback:
            row = dataclasses.replace(row, fallback_route_id=None)
            changed.append("fallback_route_id")
        elif patch.fallback_route_id is not None:
            if patch.fallback_route_id == row.id:
                raise Invalid("A model can't be its own fallback", field="fallback_route_id")
            await self._row(user_id, patch.fallback_route_id)
            row = dataclasses.replace(row, fallback_route_id=patch.fallback_route_id)
            changed.append("fallback_route_id")
        return row, new_key, reset

    async def update(self, user_id: str, route_id: str, patch: RoutePatch) -> RouteView:
        current = await self._row(user_id, route_id)
        changed: list[str] = []
        row, new_key, reset = await self._apply(user_id, current, patch, changed)
        if reset:
            row = dataclasses.replace(row, status="unverified", probe={})
            if row.listed_window is None:
                listed, key_ok = await self._listed_window(self._codec.credential(row), row.model)
                if key_ok:
                    row = dataclasses.replace(
                        row, listed_window=listed, status="ok", last_ok_at=_now()
                    )
        check = self._codec.check(row)
        if check.too_small:
            raise too_small(check)
        others: list[repo.RouteRow] = []
        if new_key is not None and patch.apply_to_same_key:
            others = await self._same_key(user_id, current)
        async with self._engine.begin() as conn:
            row = await repo.update_route(conn, row)
            for other in others:
                enc, key_id = self._codec.seal_key(other.id, new_key or "")
                await repo.update_route(
                    conn,
                    dataclasses.replace(
                        other,
                        api_key_enc=enc,
                        key_id=key_id,
                        key_last4=row.key_last4,
                        status=row.status,
                        last_ok_at=row.last_ok_at,
                        probe={},
                    ),
                )
            if patch.director is not None:
                if patch.director:
                    await repo.set_director(conn, user_id, row.id)
                elif row.is_director:
                    await repo.set_director(conn, user_id, None)
                changed.append("director")
        log.info(
            "route.updated",
            route_id=row.id,
            provider=row.provider,
            model=row.model,
            fields_changed=changed,
            reset=reset,
            same_key_updated=len(others),
            endpoint_host=inp.endpoint_host(row.base_url),
        )
        return await self.get(user_id, row.id)

    async def _same_key(self, user_id: str, current: repo.RouteRow) -> list[repo.RouteRow]:
        """换 Key 之前和 current 用同一个 Key 的其他模型。"""
        async with self._engine.connect() as conn:
            rows = await repo.list_routes(conn, user_id)
        prints = self._codec.fingerprints(rows)
        old = prints.get(current.id)
        return [r for r in rows if r.id != current.id and old and prints[r.id] == old]

    async def delete(self, user_id: str, route_id: str) -> None:
        if not is_uuid(route_id):
            raise NotFound("Model not found")
        async with self._engine.begin() as conn:
            if not await repo.delete_route(conn, user_id, route_id):
                raise NotFound("Model not found")
        log.info("route.deleted", route_id=route_id)

    # ---- 测试 --------------------------------------------------------------------------
    async def probe(self, user_id: str, route_id: str) -> ProbeReport:
        row = await self._row(user_id, route_id)
        cred = self._codec.credential(row)
        started = time.perf_counter()
        report = await probe_model(
            self._hub.adapter(row.provider), cred, row.model, self._codec.caps(row)
        )
        fatal = report.fatal_error or ""
        status = (
            "invalid" if fatal.startswith(ErrorClass.AUTH.value) else ("ok" if not fatal else None)
        )
        async with self._engine.begin() as conn:
            await repo.set_status(
                conn,
                row.id,
                status=status,
                ok=not fatal,
                probe={"report": report.to_json(), "caps": report.caps_overlay()},
            )
        log.info(
            "route.probe",
            route_id=row.id,
            provider=row.provider,
            model=row.model,
            ok=not fatal,
            fatal=fatal.split(":", 1)[0] if fatal else None,
            duration_ms=_elapsed_ms(started),
        )
        return report

    # ---- 运行时 ------------------------------------------------------------------------
    async def resolve(
        self, user_id: str, task: RouteTask, playthrough_id: str | None = None
    ) -> ResolvedRoute | None:
        """task 用的模型：目前所有 task 都用导演这一行。playthrough_id 留给以后的单局覆盖。"""
        async with self._engine.connect() as conn:
            row = await repo.get_director(conn, user_id)
            fallback_row = (
                await repo.get_route(conn, user_id, row.fallback_route_id)
                if row is not None and row.fallback_route_id
                else None
            )
        if row is None:
            return None
        fallback = self._resolved(fallback_row, task) if fallback_row is not None else None
        return self._resolved(row, task, fallback)

    def _resolved(
        self, row: repo.RouteRow, task: RouteTask, fallback: ResolvedRoute | None = None
    ) -> ResolvedRoute:
        params = inp.parse_params(row.params)
        caps = self._codec.caps(row)
        return ResolvedRoute(
            route_id=row.id,
            task=task,
            provider=row.provider,
            model=row.model,
            credential=self._codec.credential(row),
            caps=caps,
            params=params,
            window=window_for(caps, params, task),
            fallback=fallback,
        )

    async def note_window(self, user_id: str, route_id: str, window: int) -> bool:
        """服务商报超长时写明了上限：记下来，以后都按它算。只会往小调。"""
        async with self._engine.begin() as conn:
            lowered = await repo.lower_learned_window(conn, user_id, route_id, window)
        if lowered:
            log.warning("route.window_learned", route_id=route_id, window=window)
        return lowered
