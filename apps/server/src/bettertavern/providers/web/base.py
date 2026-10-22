"""联网服务的统一形状（docs/workbench.md 第 5 节，照 hermes agent 的做法）。

每家服务商一个类，声明能不能搜、能不能搜图、能不能读网页；统一返回 SearchHit、ImageHit、Page。
搜索只给标题、地址、一句摘要，不带正文；读网页返回去掉 HTML 的正文（Markdown）。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx


class WebError(Exception):
    """kind：auth（Key 不对）、quota（额度或限流）、blocked（地址不允许）、binary（不是网页）、
    too_large、empty（读出来是空的）、http（对方返回错误）、network、bad_response。"""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


@dataclass(frozen=True, slots=True)
class SearchHit:
    title: str
    url: str
    snippet: str


@dataclass(frozen=True, slots=True)
class ImageHit:
    image_url: str
    page_url: str = ""
    thumb_url: str = ""
    title: str = ""
    width: int | None = None
    height: int | None = None
    license: str = ""  # 拿得到时的版权说明（原样），拿不到为空


@dataclass(frozen=True, slots=True)
class Page:
    url: str
    final_url: str
    title: str
    content: str  # Markdown 正文
    fetcher: str  # local 或服务商名


@dataclass(frozen=True, slots=True)
class WebConfig:
    """一个配置好的服务：Key、地址（SearXNG 必填）、参数（地区、语言、安全搜索级别）。"""

    api_key: str = ""
    base_url: str = ""
    params: Mapping[str, Any] = field(default_factory=dict)


class WebProvider(Protocol):
    id: str
    can_search: bool
    can_images: bool
    can_fetch: bool
    needs_key: bool
    needs_base_url: bool

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]: ...

    async def images(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[ImageHit]: ...

    async def fetch(
        self, client: httpx.AsyncClient, config: WebConfig, urls: Sequence[str]
    ) -> list[Page | WebError]: ...


def raise_for(response: httpx.Response, vendor: str) -> None:
    """服务商返回的错误 → WebError（说明里不带 Key）。"""
    if response.status_code < 400:
        return
    if response.status_code in (401, 403):
        raise WebError("auth", f"{vendor} rejected the key ({response.status_code})")
    if response.status_code in (402, 429):
        raise WebError(
            "quota", f"{vendor} is out of quota or rate-limiting ({response.status_code})"
        )
    raise WebError("http", f"{vendor} returned HTTP {response.status_code}")


def json_of(response: httpx.Response, vendor: str) -> Any:
    try:
        return response.json()
    except ValueError as exc:
        raise WebError("bad_response", f"{vendor} returned something that isn't JSON") from exc


def text(value: Any, limit: int = 500) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.isdigit():
        return int(value) or None
    return None


class Unsupported:
    """没实现的能力：调用时报错。"""

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]:
        raise WebError("unsupported", "This service can't search")

    async def images(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[ImageHit]:
        raise WebError("unsupported", "This service can't search images")

    async def fetch(
        self, client: httpx.AsyncClient, config: WebConfig, urls: Sequence[str]
    ) -> list[Page | WebError]:
        raise WebError("unsupported", "This service can't read pages")
