"""凭据：玩家自带的模型密钥与端点。

- 密钥信封加密，接口只回后四位；只在请求前解密，用完不缓存明文；
- 自定义端点创建和修改时做 SSRF 校验（请求时 SafeTransport 还会再校验一次）；
- 探测结果按模型存在 probed.models[model]，模型列表里的上下文长度存在 probed.listed。
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.envelope import DecryptionError, key_id_of, seal_text, unseal_text
from bettertavern.infra.crypto.keyring import Keyring
from bettertavern.infra.db.repositories import credentials as repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.providers import (
    Capabilities,
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

from .errors import AppError, Invalid, NotFound

MAX_LABEL = 60
MAX_KEY_CHARS = 4096
MAX_HEADERS = 20
MAX_EXTRA_BODY_BYTES = 8 * 1024
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$")
_FORBIDDEN_HEADERS = frozenset(
    {"authorization", "host", "content-length", "transfer-encoding", "connection", "cookie"}
)


@dataclass(frozen=True, slots=True)
class ProviderInfo:
    id: str
    display_name: str
    default_base_url: str | None
    requires_base_url: bool


@dataclass(frozen=True, slots=True)
class ProbedModel:
    model: str
    probed_at: str
    ok: bool
    fatal_error: str | None
    checks: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class CredentialView:
    id: str
    provider: str
    label: str
    base_url: str | None
    key_last4: str
    extra_header_names: list[str]
    extra_body: dict[str, Any]
    status: str
    last_ok_at: datetime | None
    probed_models: list[ProbedModel]
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class CredentialInput:
    provider: str
    label: str
    api_key: str
    base_url: str | None = None
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class CredentialPatch:
    label: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    clear_base_url: bool = False
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None


def _aad(credential_id: str, field: str) -> str:
    return f"credential:{credential_id}:{field}"


def _last4(key: str) -> str:
    return key[-4:] if len(key) >= 8 else ""


def _validate_headers(headers: Mapping[str, str] | None) -> dict[str, str]:
    if not headers:
        return {}
    if len(headers) > MAX_HEADERS:
        raise Invalid(f"自定义请求头最多 {MAX_HEADERS} 个", field="extra_headers")
    clean: dict[str, str] = {}
    for name, value in headers.items():
        if not _HEADER_NAME.match(name):
            raise Invalid(f"请求头名称不合法：{name!r}", field="extra_headers")
        if name.lower() in _FORBIDDEN_HEADERS:
            raise Invalid(f"不能自定义请求头 {name}", field="extra_headers")
        text = str(value)
        if len(text) > 2000 or "\n" in text or "\r" in text:
            raise Invalid(f"请求头 {name} 的值不合法", field="extra_headers")
        clean[name] = text
    return clean


def _validate_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    if len(json.dumps(body, ensure_ascii=False).encode()) > MAX_EXTRA_BODY_BYTES:
        raise Invalid("自定义请求体字段太大", field="extra_body")
    return dict(body)


class CredentialService:
    def __init__(
        self, engine: AsyncEngine, keyring: Keyring, hub: ProviderHub, policy: EndpointPolicy
    ) -> None:
        self._engine = engine
        self._keyring = keyring
        self._hub = hub
        self._policy = policy

    # ---- 厂商 --------------------------------------------------------------------------
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

    # ---- 视图 --------------------------------------------------------------------------
    def _view(self, row: repo.CredentialRow) -> CredentialView:
        header_names: list[str] = []
        if row.extra_headers_enc:
            try:
                header_names = sorted(self._headers(row))
            except AppError:
                header_names = []
        models = []
        for model, entry in sorted((row.probed.get("models") or {}).items()):
            report = entry.get("report") or {}
            models.append(
                ProbedModel(
                    model=model,
                    probed_at=str(report.get("probed_at", "")),
                    ok=report.get("fatal_error") is None,
                    fatal_error=report.get("fatal_error"),
                    checks=list(report.get("checks") or []),
                )
            )
        return CredentialView(
            id=row.id,
            provider=row.provider,
            label=row.label,
            base_url=row.base_url,
            key_last4=row.key_last4,
            extra_header_names=header_names,
            extra_body=row.extra_body,
            status=row.status,
            last_ok_at=row.last_ok_at,
            probed_models=models,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _headers(self, row: repo.CredentialRow) -> dict[str, str]:
        if not row.extra_headers_enc:
            return {}
        try:
            text = unseal_text(self._keyring, row.extra_headers_enc, aad=_aad(row.id, "headers"))
        except DecryptionError as exc:
            raise AppError(
                "凭据无法解密，请重新填写", code="CREDENTIAL_UNREADABLE", status=409
            ) from exc
        data = json.loads(text)
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}

    async def list(self, user_id: str) -> list[CredentialView]:
        async with self._engine.connect() as conn:
            rows = await repo.list_credentials(conn, user_id)
        return [self._view(r) for r in rows]

    async def _row(self, user_id: str, credential_id: str) -> repo.CredentialRow:
        if not is_uuid(credential_id):
            raise NotFound("凭据不存在")
        async with self._engine.connect() as conn:
            row = await repo.get_credential(conn, user_id, credential_id)
        if row is None:
            raise NotFound("凭据不存在")
        return row

    async def get(self, user_id: str, credential_id: str) -> CredentialView:
        return self._view(await self._row(user_id, credential_id))

    # ---- 写入 --------------------------------------------------------------------------
    async def _check_endpoint(self, provider: str, base_url: str | None) -> str | None:
        profile = self._hub.registry.get(provider)
        url = (base_url or "").strip() or None
        if url is None:
            if profile.requires_base_url or not profile.default_base_url:
                raise Invalid(f"{profile.display_name} 需要填写接口地址", field="base_url")
            return None
        url = url.rstrip("/")
        if len(url) > 500:
            raise Invalid("接口地址太长", field="base_url")
        try:
            await validate_endpoint(url, self._policy)
        except EndpointNotAllowed as exc:
            raise AppError(
                f"接口地址不可用：{exc.reason}",
                code="ENDPOINT_NOT_ALLOWED",
                status=422,
                reason=exc.reason,
            ) from exc
        return url

    def _check_provider(self, provider: str) -> None:
        if provider not in self._hub.registry:
            raise Invalid(f"不支持的服务商：{provider}", field="provider")

    async def create(self, user_id: str, data: CredentialInput) -> CredentialView:
        self._check_provider(data.provider)
        label = data.label.strip()[:MAX_LABEL] or self._hub.registry.get(data.provider).display_name
        key = data.api_key.strip()
        if not key or len(key) > MAX_KEY_CHARS:
            raise Invalid("请填写有效的 API Key", field="api_key")
        headers = _validate_headers(data.extra_headers)
        body = _validate_body(data.extra_body)
        base_url = await self._check_endpoint(data.provider, data.base_url)
        credential_id = str(uuid.uuid4())
        api_key_enc = seal_text(self._keyring, key, aad=_aad(credential_id, "api_key"))
        headers_enc = (
            seal_text(self._keyring, json.dumps(headers), aad=_aad(credential_id, "headers"))
            if headers
            else None
        )
        async with self._engine.begin() as conn:
            row = await repo.insert_credential(
                conn,
                credential_id=credential_id,
                user_id=user_id,
                provider=data.provider,
                label=label,
                base_url=base_url,
                api_key_enc=api_key_enc,
                key_id=key_id_of(api_key_enc),
                key_last4=_last4(key),
                extra_headers_enc=headers_enc,
                extra_body=body,
            )
        return self._view(row)

    async def update(
        self, user_id: str, credential_id: str, patch: CredentialPatch
    ) -> CredentialView:
        current = await self._row(user_id, credential_id)
        label = (
            current.label
            if patch.label is None
            else (patch.label.strip()[:MAX_LABEL] or current.label)
        )
        api_key_enc, key_last4 = current.api_key_enc, current.key_last4
        changed_auth = False
        if patch.api_key is not None:
            key = patch.api_key.strip()
            if not key or len(key) > MAX_KEY_CHARS:
                raise Invalid("请填写有效的 API Key", field="api_key")
            api_key_enc = seal_text(self._keyring, key, aad=_aad(current.id, "api_key"))
            key_last4 = _last4(key)
            changed_auth = True
        base_url = current.base_url
        if patch.clear_base_url:
            base_url = await self._check_endpoint(current.provider, None)
            changed_auth = True
        elif patch.base_url is not None:
            base_url = await self._check_endpoint(current.provider, patch.base_url)
            changed_auth = changed_auth or base_url != current.base_url
        headers_enc = current.extra_headers_enc
        if patch.extra_headers is not None:
            headers = _validate_headers(patch.extra_headers)
            headers_enc = (
                seal_text(self._keyring, json.dumps(headers), aad=_aad(current.id, "headers"))
                if headers
                else None
            )
        body = current.extra_body if patch.extra_body is None else _validate_body(patch.extra_body)
        async with self._engine.begin() as conn:
            row = await repo.update_credential(
                conn,
                current.id,
                label=label,
                base_url=base_url,
                api_key_enc=api_key_enc,
                key_id=key_id_of(api_key_enc),
                key_last4=key_last4,
                extra_headers_enc=headers_enc,
                extra_body=body,
                # 换了密钥或端点，之前的探测结果不再可信
                status="unverified" if changed_auth else current.status,
                probed={} if changed_auth else current.probed,
            )
        return self._view(row)

    async def delete(self, user_id: str, credential_id: str) -> None:
        if not is_uuid(credential_id):
            raise NotFound("凭据不存在")
        async with self._engine.begin() as conn:
            if not await repo.delete_credential(conn, user_id, credential_id):
                raise NotFound("凭据不存在")

    # ---- 解密与能力 ----------------------------------------------------------------------
    def resolve_row(self, row: repo.CredentialRow) -> ResolvedCredential:
        try:
            key = unseal_text(self._keyring, row.api_key_enc, aad=_aad(row.id, "api_key"))
        except DecryptionError as exc:
            raise AppError(
                "凭据无法解密（主密钥可能变了），请重新填写 API Key",
                code="CREDENTIAL_UNREADABLE",
                status=409,
            ) from exc
        return ResolvedCredential(
            credential_id=row.id,
            provider=row.provider,
            api_key=Secret(key),
            base_url=row.base_url,
            extra_headers=self._headers(row),
            extra_body=row.extra_body,
        )

    def capabilities(
        self, row: repo.CredentialRow, model: str, override: Mapping[str, Any] | None = None
    ) -> Capabilities:
        overlay: dict[str, Any] = {}
        listed = (row.probed.get("listed") or {}).get("windows") or {}
        window = listed.get(model)
        if isinstance(window, int) and window > 0:
            overlay["context_window"] = window
        probed = ((row.probed.get("models") or {}).get(model) or {}).get("caps") or {}
        overlay.update(probed)
        return self._hub.capabilities(
            row.provider, model, probed=overlay or None, override=dict(override or {}) or None
        )

    # ---- 探测与模型列表 ------------------------------------------------------------------
    async def probe(self, user_id: str, credential_id: str, model: str) -> ProbeReport:
        model = model.strip()
        if not model or len(model) > 200:
            raise Invalid("请填写模型名", field="model")
        row = await self._row(user_id, credential_id)
        cred = self.resolve_row(row)
        adapter = self._hub.adapter(row.provider)
        caps = self.capabilities(row, model)
        report = await probe_model(adapter, cred, model, caps)
        probed = dict(row.probed)
        models = dict(probed.get("models") or {})
        models[model] = {"report": report.to_json(), "caps": report.caps_overlay()}
        probed["models"] = models
        fatal = report.fatal_error or ""
        status = (
            "invalid" if fatal.startswith(ErrorClass.AUTH.value) else ("ok" if not fatal else None)
        )
        async with self._engine.begin() as conn:
            await repo.set_credential_probe(
                conn, row.id, probed=probed, status=status, ok=not fatal
            )
        return report

    async def list_models(self, user_id: str, credential_id: str) -> list[ModelInfo]:
        row = await self._row(user_id, credential_id)
        cred = self.resolve_row(row)
        try:
            models = await self._hub.adapter(row.provider).list_models(cred)
        except ProviderError as exc:
            if exc.error_class is ErrorClass.AUTH:
                async with self._engine.begin() as conn:
                    await repo.set_credential_probe(
                        conn, row.id, probed=row.probed, status="invalid", ok=False
                    )
                raise AppError(
                    "服务商拒绝了这把密钥", code="CREDENTIAL_INVALID", status=424
                ) from exc
            raise AppError(
                f"获取模型列表失败：{exc.message[:200]}",
                code="PROVIDER_ERROR",
                status=502,
                error_class=exc.error_class.value,
                retryable=exc.retryable,
            ) from exc
        windows = {m.id: m.context_window for m in models if m.context_window}
        probed = dict(row.probed)
        probed["listed"] = {
            "at": datetime.now(UTC).isoformat(timespec="seconds"),
            "windows": windows,
        }
        async with self._engine.begin() as conn:
            await repo.set_credential_probe(
                conn, row.id, probed=probed, status="ok" if row.status != "ok" else None, ok=True
            )
        return models
