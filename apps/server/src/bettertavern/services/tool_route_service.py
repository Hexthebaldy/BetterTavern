"""外部服务的配置（docs/workbench.md 第 3.12、5、6 节）：搜索、读网页、文生图。

- 合法的服务商（搜索、读网页）和接口协议（文生图）由 providers 里的注册表决定；
- Key 和模型路由一样用信封加密存，行 id 绑进附加数据；接口只返回后四位；
- 地址写入前做防内网访问检查；文生图“并进请求体的自定义字段”最大 8 KB；
- 每种第一次添加的自动设为默认；“测试”真的搜一个词、读一个页面或者出一张小图，结果记进 probe。
- worker 通过 resolve_tools 拿到解密后的默认配置（ToolResolver）。
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.envelope import DecryptionError, key_id_of, seal_text, unseal_text
from bettertavern.infra.crypto.keyring import Keyring
from bettertavern.infra.db.repositories import tool_routes as repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.providers import EndpointNotAllowed, EndpointPolicy, validate_endpoint
from bettertavern.providers.image import (
    IMAGE_PROTOCOLS,
    MAX_EXTRA_BODY_BYTES,
    ImageConfig,
    ImageError,
)
from bettertavern.providers.web import WEB_PROVIDERS, WebConfig, WebError
from bettertavern.runtime.ports import ResolvedTools, ToolConfig

from .errors import AppError, Invalid, NotFound

log = structlog.get_logger(__name__)

Kind = Literal["search", "fetch", "image"]
MAX_LABEL = 60
MAX_PARAMS_BYTES = 8 * 1024
TEST_TIMEOUT_S = 60.0


@dataclass(frozen=True, slots=True)
class ToolProviderInfo:
    id: str
    kinds: list[str]
    can_search: bool
    can_images: bool
    can_fetch: bool
    needs_key: bool
    needs_base_url: bool
    needs_model: bool
    max_references: int


@dataclass(frozen=True, slots=True)
class ToolRouteView:
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


@dataclass(frozen=True, slots=True)
class ToolRouteInput:
    kind: Kind
    provider: str
    label: str = ""
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    params: Mapping[str, Any] | None = None
    default: bool = False


@dataclass(frozen=True, slots=True)
class ToolRoutePatch:
    label: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    clear_base_url: bool = False
    model: str | None = None
    params: Mapping[str, Any] | None = None
    default: bool | None = None


def providers() -> list[ToolProviderInfo]:
    """设置页用：能选哪些服务商和协议、各自要填什么。"""
    items = [
        ToolProviderInfo(
            id=p.id,
            kinds=[k for k, ok in (("search", p.can_search), ("fetch", p.can_fetch)) if ok],
            can_search=p.can_search,
            can_images=p.can_images,
            can_fetch=p.can_fetch,
            needs_key=p.needs_key,
            needs_base_url=p.needs_base_url,
            needs_model=False,
            max_references=0,
        )
        for p in WEB_PROVIDERS.values()
    ]
    items += [
        ToolProviderInfo(
            id=p.id,
            kinds=["image"],
            can_search=False,
            can_images=False,
            can_fetch=False,
            needs_key=True,
            needs_base_url=p.needs_base_url,
            needs_model=True,
            max_references=p.max_references,
        )
        for p in IMAGE_PROTOCOLS.values()
    ]
    return items


def _aad(route_id: str) -> str:
    return f"tool:{route_id}:api_key"


def _view(row: repo.ToolRouteRow) -> ToolRouteView:
    return ToolRouteView(
        id=row.id,
        kind=row.kind,
        provider=row.provider,
        label=row.label,
        base_url=row.base_url,
        key_last4=row.key_last4,
        has_key=row.api_key_enc is not None,
        model=row.model,
        params=row.params,
        status=row.status,
        probe=row.probe,
        is_default=row.is_default,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _check_provider(kind: str, provider: str) -> None:
    if kind == "image":
        if provider not in IMAGE_PROTOCOLS:
            raise Invalid(f"Unknown image protocol: {provider}", field="provider")
        return
    web = WEB_PROVIDERS.get(provider)
    if web is None:
        raise Invalid(f"Unknown service: {provider}", field="provider")
    if kind == "search" and not web.can_search:
        raise Invalid(f"{provider} can't search", field="provider")
    if kind == "fetch" and not web.can_fetch:
        raise Invalid(f"{provider} can't read pages", field="provider")


def _needs(kind: str, provider: str) -> tuple[bool, bool, bool]:
    """（要不要 Key，要不要地址，要不要模型名）"""
    if kind == "image":
        protocol = IMAGE_PROTOCOLS[provider]
        return True, protocol.needs_base_url, True
    web = WEB_PROVIDERS[provider]
    return web.needs_key, web.needs_base_url, False


def _params(value: Mapping[str, Any] | None) -> dict[str, Any]:
    params = dict(value or {})
    encoded = json.dumps(params, ensure_ascii=False)
    if len(encoded.encode()) > MAX_PARAMS_BYTES:
        raise Invalid("Parameters are larger than 8 KB", field="params")
    extra = params.get("extra_body")
    if extra is not None:
        if not isinstance(extra, dict):
            raise Invalid("extra_body must be an object", field="params")
        if len(json.dumps(extra).encode()) > MAX_EXTRA_BODY_BYTES:
            raise Invalid("extra_body is larger than 8 KB", field="params")
    return params


class ToolRouteService:
    def __init__(
        self,
        engine: AsyncEngine,
        keyring: Keyring,
        policy: EndpointPolicy,
        client: httpx.AsyncClient | None = None,
        platform_search: ToolConfig | None = None,
    ) -> None:
        self._engine = engine
        self._keyring = keyring
        self._policy = policy
        self._client = client
        # 官方搜索（运营方的 Key，只用免费额度）：用户自己没配搜索时工作台 agent 用它
        self._platform_search = platform_search

    # ---- 增删改查 ----

    async def list(self, user_id: str) -> list[ToolRouteView]:
        async with self._engine.connect() as conn:
            rows = await repo.list_routes(conn, user_id)
        return [_view(r) for r in rows]

    async def _row(self, user_id: str, route_id: str) -> repo.ToolRouteRow:
        if not is_uuid(route_id):
            raise NotFound("Service not found")
        async with self._engine.connect() as conn:
            row = await repo.get_route(conn, user_id, route_id)
        if row is None:
            raise NotFound("Service not found")
        return row

    async def _check_base_url(self, url: str | None) -> str | None:
        if url is None:
            return None
        url = url.strip().rstrip("/")
        if not url:
            return None
        try:
            await validate_endpoint(url, self._policy)
        except EndpointNotAllowed as exc:
            raise AppError(
                str(exc), code="ENDPOINT_NOT_ALLOWED", status=422, reason=str(exc)
            ) from exc
        return url

    async def create(self, user_id: str, data: ToolRouteInput) -> ToolRouteView:
        _check_provider(data.kind, data.provider)
        needs_key, needs_url, needs_model = _needs(data.kind, data.provider)
        key = (data.api_key or "").strip()
        if needs_key and not key:
            raise Invalid("This service needs an API key", field="api_key")
        base_url = await self._check_base_url(data.base_url)
        if needs_url and not base_url:
            raise Invalid("This service needs its address", field="base_url")
        model = (data.model or "").strip()[:200] or None
        if needs_model and not model:
            raise Invalid("Enter the model name", field="model")
        route_id = str(uuid.uuid4())
        enc = seal_text(self._keyring, key, aad=_aad(route_id)) if key else None
        now = datetime.now(UTC)
        row = repo.ToolRouteRow(
            id=route_id,
            user_id=user_id,
            kind=data.kind,
            provider=data.provider,
            label=data.label.strip()[:MAX_LABEL],
            base_url=base_url,
            api_key_enc=enc,
            key_id=key_id_of(enc) if enc else None,
            key_last4=key[-4:] if len(key) >= 8 else "",
            model=model,
            params=_params(data.params),
            status="unverified",
            probe={},
            is_default=False,
            created_at=now,
            updated_at=now,
        )
        async with self._engine.begin() as conn:
            created = await repo.insert_route(conn, row)
            current = await repo.get_default(conn, user_id, data.kind)
            if data.default or current is None:
                await repo.set_default(conn, user_id, data.kind, created.id)
            fresh = await repo.get_route(conn, user_id, created.id)
        assert fresh is not None
        log.info("tool_route.created", route_id=route_id, kind=data.kind, provider=data.provider)
        return _view(fresh)

    async def update(self, user_id: str, route_id: str, patch: ToolRoutePatch) -> ToolRouteView:
        row = await self._row(user_id, route_id)
        changed = row
        reset = False
        if patch.label is not None:
            changed = replace(changed, label=patch.label.strip()[:MAX_LABEL])
        if patch.api_key is not None and patch.api_key.strip():
            key = patch.api_key.strip()
            enc = seal_text(self._keyring, key, aad=_aad(row.id))
            changed = replace(
                changed,
                api_key_enc=enc,
                key_id=key_id_of(enc),
                key_last4=key[-4:] if len(key) >= 8 else "",
            )
            reset = True
        if patch.clear_base_url:
            changed = replace(changed, base_url=None)
            reset = True
        elif patch.base_url is not None:
            changed = replace(changed, base_url=await self._check_base_url(patch.base_url))
            reset = True
        if patch.model is not None:
            changed = replace(changed, model=patch.model.strip()[:200] or None)
            reset = True
        if patch.params is not None:
            changed = replace(changed, params=_params(patch.params))
        _, needs_url, needs_model = _needs(row.kind, row.provider)
        if needs_url and not changed.base_url:
            raise Invalid("This service needs its address", field="base_url")
        if needs_model and not changed.model:
            raise Invalid("Enter the model name", field="model")
        if reset:
            changed = replace(changed, status="unverified", probe={})
        async with self._engine.begin() as conn:
            updated = await repo.update_route(conn, changed)
            assert updated is not None
            if patch.default is True:
                await repo.set_default(conn, user_id, row.kind, row.id)
            elif patch.default is False and row.is_default:
                await repo.set_default(conn, user_id, row.kind, None)
            fresh = await repo.get_route(conn, user_id, row.id)
        assert fresh is not None
        return _view(fresh)

    async def delete(self, user_id: str, route_id: str) -> None:
        if not is_uuid(route_id):
            raise NotFound("Service not found")
        async with self._engine.begin() as conn:
            row = await repo.delete_route(conn, user_id, route_id)
            if row is None:
                raise NotFound("Service not found")
            if row.is_default:  # 删了默认的：同一种里最早添加的那个顶上
                remaining = [r for r in await repo.list_routes(conn, user_id) if r.kind == row.kind]
                if remaining:
                    await repo.set_default(conn, user_id, row.kind, remaining[0].id)
        log.info("tool_route.deleted", route_id=route_id, kind=row.kind)

    # ---- 解密和测试 ----

    def config(self, row: repo.ToolRouteRow) -> ToolConfig:
        key = ""
        if row.api_key_enc:
            try:
                key = unseal_text(self._keyring, row.api_key_enc, aad=_aad(row.id))
            except DecryptionError as exc:
                log.error("tool_route.key_unreadable", route_id=row.id)
                raise AppError(
                    "This service's key can't be decrypted; enter the key again",
                    code="CREDENTIAL_UNREADABLE",
                    status=409,
                ) from exc
        return ToolConfig(
            route_id=row.id,
            kind=row.kind,  # type: ignore[arg-type]
            provider=row.provider,
            label=row.label,
            api_key=key,
            base_url=row.base_url or "",
            model=row.model or "",
            params=row.params,
        )

    async def resolve_tools(self, user_id: str) -> ResolvedTools:
        found: dict[str, ToolConfig | None] = {}
        async with self._engine.connect() as conn:
            for kind in ("search", "fetch", "image"):
                row = await repo.get_default(conn, user_id, kind)
                try:
                    found[kind] = self.config(row) if row is not None else None
                except AppError:
                    found[kind] = None
        return ResolvedTools(
            search=found["search"],
            fetch=found["fetch"],
            image=found["image"],
            platform_search=self._platform_search,
        )

    async def default_image(self, user_id: str) -> ToolConfig | None:
        return (await self.resolve_tools(user_id)).image

    async def test(self, user_id: str, route_id: str) -> ToolRouteView:
        """搜一个词、读一个页面，或者出一张小图。结果记进 probe，状态变成 ok 或 invalid。"""
        row = await self._row(user_id, route_id)
        config = self.config(row)
        client = self._client
        assert client is not None
        started = time.perf_counter()
        ok = False
        detail = ""
        try:
            async with asyncio.timeout(TEST_TIMEOUT_S):
                ok, detail = await self._probe(client, row, config)
        except (WebError, ImageError) as exc:
            detail = f"{exc.kind}: {exc.message}"
        except httpx.HTTPError as exc:
            detail = f"network: {type(exc).__name__}"
        except TimeoutError:
            detail = "timeout"
        latency = int((time.perf_counter() - started) * 1000)
        probe = {
            "ok": ok,
            "detail": detail[:300],
            "latency_ms": latency,
            "tested_at": datetime.now(UTC).isoformat(),
        }
        async with self._engine.begin() as conn:
            await repo.set_status(conn, row.id, status="ok" if ok else "invalid", probe=probe)
            fresh = await repo.get_route(conn, user_id, row.id)
        assert fresh is not None
        log.info(
            "tool_route.tested",
            route_id=row.id,
            kind=row.kind,
            provider=row.provider,
            ok=ok,
            duration_ms=latency,
        )
        return _view(fresh)

    async def _probe(
        self, client: httpx.AsyncClient, row: repo.ToolRouteRow, config: ToolConfig
    ) -> tuple[bool, str]:
        if row.kind == "image":
            protocol = IMAGE_PROTOCOLS[row.provider]
            images = await protocol.generate(
                client,
                ImageConfig(
                    model=config.model,
                    api_key=config.api_key,
                    base_url=config.base_url,
                    params=config.params,
                ),
                prompt="A small red circle on a white background",
                aspect="square",
                count=1,
            )
            return bool(images), f"{len(images)} image"
        web = WebConfig(api_key=config.api_key, base_url=config.base_url, params=config.params)
        provider = WEB_PROVIDERS[row.provider]
        if row.kind == "search":
            hits = await provider.search(client, web, "BetterTavern", 3)
            return True, f"{len(hits)} results"
        pages = await provider.fetch(client, web, ["https://example.com/"])
        first = pages[0] if pages else WebError("empty", "No result")
        if isinstance(first, WebError):
            raise first
        return True, f"{len(first.content)} characters"
