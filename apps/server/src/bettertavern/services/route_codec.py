"""一行模型路由的“解读”：解密 Key 和请求头、算能力和上下文窗口。route_service 和 route_views 共用。

上下文窗口的来源依次是：服务商的模型列表 > 内置能力表 > 玩家手填 > 32K 估计；
运行中学到的窗口（服务商报超长时写明的上限）比这些小时以它为准。
"""

from __future__ import annotations

import dataclasses
import json

import structlog

from bettertavern.domain.memory.thresholds import WindowCheck
from bettertavern.domain.routing import RouteTask
from bettertavern.infra.crypto.envelope import DecryptionError, key_id_of, seal_text, unseal_text
from bettertavern.infra.crypto.keyring import Keyring
from bettertavern.infra.db.repositories.routes import RouteRow
from bettertavern.providers import Capabilities, ProviderHub, ResolvedCredential, Secret
from bettertavern.runtime.routing import DEFAULT_MODEL_WINDOW, window_for

from . import route_inputs as inp
from .errors import AppError

log = structlog.get_logger(__name__)


class RouteCodec:
    def __init__(self, keyring: Keyring, hub: ProviderHub) -> None:
        self._keyring = keyring
        self._hub = hub

    # ---- 加密 --------------------------------------------------------------------------
    def seal_key(self, route_id: str, key: str) -> tuple[str, str]:
        """返回（密文，主密钥编号）。"""
        enc = seal_text(self._keyring, key, aad=inp.aad(route_id, "api_key"))
        return enc, key_id_of(enc)

    def seal_headers(self, route_id: str, headers: dict[str, str]) -> str | None:
        if not headers:
            return None
        return seal_text(self._keyring, json.dumps(headers), aad=inp.aad(route_id, "headers"))

    def _unreadable(self, row: RouteRow) -> AppError:
        log.error("route.key_unreadable", route_id=row.id, key_id=key_id_of(row.api_key_enc))
        return AppError(
            "This model's key can't be decrypted (the server's master key may have changed). "
            "Please enter the key again",
            code="CREDENTIAL_UNREADABLE",
            status=409,
        )

    def key(self, row: RouteRow) -> str:
        try:
            return unseal_text(self._keyring, row.api_key_enc, aad=inp.aad(row.id, "api_key"))
        except DecryptionError as exc:
            raise self._unreadable(row) from exc

    def headers(self, row: RouteRow) -> dict[str, str]:
        if not row.extra_headers_enc:
            return {}
        try:
            text = unseal_text(self._keyring, row.extra_headers_enc, aad=inp.aad(row.id, "headers"))
        except DecryptionError as exc:
            raise self._unreadable(row) from exc
        data = json.loads(text)
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}

    def credential(self, row: RouteRow) -> ResolvedCredential:
        key = self.key(row)
        return ResolvedCredential(
            credential_id=inp.key_fingerprint(row.provider, key),
            provider=row.provider,
            api_key=Secret(key),
            base_url=row.base_url,
            extra_headers=self.headers(row),
            extra_body=row.extra_body,
        )

    def fingerprints(self, rows: list[RouteRow]) -> dict[str, str | None]:
        """每行 Key 的指纹；解不开的行为 None（不算和谁共用）。"""
        out: dict[str, str | None] = {}
        for row in rows:
            try:
                out[row.id] = inp.key_fingerprint(row.provider, self.key(row))
            except AppError:
                out[row.id] = None
        return out

    # ---- 能力与窗口 ----------------------------------------------------------------------
    def model_window(self, row: RouteRow) -> tuple[int, str]:
        """这个模型的上下文窗口和来源：listed / table / manual / default，或者 learned。"""
        table = self._hub.capabilities(row.provider, row.model).context_window
        if row.listed_window:
            window, source = row.listed_window, "listed"
        elif table:
            window, source = table, "table"
        elif row.manual_window:
            window, source = row.manual_window, "manual"
        else:
            window, source = DEFAULT_MODEL_WINDOW, "default"
        if row.learned_window and row.learned_window < window:
            return row.learned_window, "learned"
        return window, source

    def caps(self, row: RouteRow) -> Capabilities:
        """能力表 < 测试结果 < caps_override，窗口按 model_window() 的结果。"""
        caps = self._hub.capabilities(
            row.provider,
            row.model,
            probed=row.probe.get("caps") or None,
            override=row.caps_override or None,
        )
        return dataclasses.replace(caps, context_window=self.model_window(row)[0])

    def check(self, row: RouteRow, task: RouteTask = RouteTask.DIRECTOR) -> WindowCheck:
        return window_for(self.caps(row), inp.parse_params(row.params), task)
