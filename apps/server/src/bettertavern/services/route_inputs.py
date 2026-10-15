"""模型路由的输入：请求里的数据结构、字段校验、密钥加密用的附加数据和指纹。

纯函数，route_service 使用。
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from pydantic import ValidationError

from bettertavern.domain.routing import RouteParams
from bettertavern.providers import Capabilities

from .errors import Invalid

MAX_LABEL = 60
MAX_MODEL = 200
MAX_KEY_CHARS = 4096
MAX_HEADERS = 20
MAX_EXTRA_BODY_BYTES = 8 * 1024
MIN_MANUAL_WINDOW = 4096
MAX_MANUAL_WINDOW = 10_000_000
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$")
_FORBIDDEN_HEADERS = frozenset(
    {"authorization", "host", "content-length", "transfer-encoding", "connection", "cookie"}
)


@dataclass(frozen=True, slots=True)
class RouteInput:
    """添加一个模型。api_key 和 copy_key_from 二选一：后者复用自己另一个模型的 Key。"""

    provider: str
    model: str
    label: str = ""
    api_key: str | None = None
    copy_key_from: str | None = None
    base_url: str | None = None
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None
    manual_window: int | None = None
    params: Mapping[str, Any] | None = None
    caps_override: Mapping[str, Any] | None = None
    director: bool = False


@dataclass(frozen=True, slots=True)
class RoutePatch:
    """修改一个模型；None 表示不改，clear_* 表示清空。"""

    label: str | None = None
    model: str | None = None
    api_key: str | None = None
    # 换 Key 时，把用同一个旧 Key 的其他模型也一起换掉
    apply_to_same_key: bool = False
    base_url: str | None = None
    clear_base_url: bool = False
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None
    manual_window: int | None = None
    clear_manual_window: bool = False
    params: Mapping[str, Any] | None = None
    caps_override: Mapping[str, Any] | None = None
    director: bool | None = None
    fallback_route_id: str | None = None
    clear_fallback: bool = False


def aad(route_id: str, field: str) -> str:
    """加密的附加数据绑定到行和字段：密文挪到别的行或字段会解密失败。"""
    return f"route:{route_id}:{field}"


def last4(key: str) -> str:
    return key[-4:] if len(key) >= 8 else ""


def key_fingerprint(provider: str, key: str) -> str:
    """同一个服务商的同一个 Key 得到同一个值。

    限流按它分组，也用来找出共用一个 Key 的模型。不进日志。
    """
    digest = hashlib.sha256(f"{provider}\0{key}".encode()).hexdigest()
    return f"key:{digest[:24]}"


def endpoint_host(base_url: str | None) -> str:
    """日志里只记端点的主机名。"""
    return (urlparse(base_url).hostname or "?") if base_url else "official"


def clean_label(label: str) -> str:
    return label.strip()[:MAX_LABEL]


def clean_model(model: str) -> str:
    value = model.strip()
    if not value or len(value) > MAX_MODEL:
        raise Invalid("请填写模型名", field="model")
    return value


def clean_key(key: str) -> str:
    value = key.strip()
    if not value or len(value) > MAX_KEY_CHARS:
        raise Invalid("请填写有效的 API Key", field="api_key")
    return value


def clean_manual_window(window: int) -> int:
    if not MIN_MANUAL_WINDOW <= window <= MAX_MANUAL_WINDOW:
        raise Invalid(
            f"上下文窗口要在 {MIN_MANUAL_WINDOW} 到 {MAX_MANUAL_WINDOW} 之间", field="manual_window"
        )
    return window


def clean_headers(headers: Mapping[str, str] | None) -> dict[str, str]:
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


def clean_body(body: Mapping[str, Any] | None) -> dict[str, Any]:
    if not body:
        return {}
    if len(json.dumps(body, ensure_ascii=False).encode()) > MAX_EXTRA_BODY_BYTES:
        raise Invalid("自定义请求体字段太大", field="extra_body")
    return dict(body)


def parse_params(data: Mapping[str, Any] | None) -> RouteParams:
    try:
        return RouteParams.model_validate(dict(data or {}))
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first.get("loc", ()))
        raise Invalid(
            f"路由参数不合法：{field} {first.get('msg', '')}", field=f"params.{field}"
        ) from exc


def clean_caps_override(data: Mapping[str, Any] | None) -> dict[str, Any]:
    override = dict(data or {})
    if not override:
        return {}
    if "context_window" in override:
        # 窗口有自己的来源顺序（服务商列表 > 能力表 > 手填），手填用 manual_window
        raise Invalid("上下文窗口请用 manual_window 设置", field="caps_override")
    try:
        Capabilities.from_mapping(override)
    except ValueError as exc:
        raise Invalid(f"能力覆盖不合法：{exc}", field="caps_override") from exc
    return override
