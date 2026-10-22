"""文生图的统一形状（docs/workbench.md 第 6 节）：按接口协议接，不按厂家接。

统一的输入：提示词、画幅（竖、方、横）、张数、参考图（可选）；风格由调用方拼进提示词。
每种协议声明自己能不能带参考图；不支持的参数不发。返回图片的字节（服务返回地址时由调用方下载）。
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import httpx

Aspect = Literal["portrait", "square", "landscape"]

# 画幅默认对应的尺寸；tool_routes.params.sizes 可以覆盖
DEFAULT_SIZES: Mapping[str, str] = {
    "portrait": "1024x1536",
    "square": "1024x1024",
    "landscape": "1536x1024",
}
ASPECT_RATIOS: Mapping[str, str] = {"portrait": "2:3", "square": "1:1", "landscape": "3:2"}
# 封面面板的几种风格（客户端传 ink、oil、film、flat；agent 可能写中文或日文的名字）：
# 拼进提示词时换成英文说法（多数出图模型对英文更敏感）
STYLE_HINTS: Mapping[str, str] = {
    "ink": "Chinese ink wash painting",
    "oil": "oil painting",
    "film": "film photography",
    "flat": "flat illustration",
    "水墨": "Chinese ink wash painting",
    "油画": "oil painting",
    "胶片": "film photography",
    "平涂": "flat illustration",
    "油絵": "oil painting",
    "フィルム": "film photography",
    "フラット": "flat illustration",
}
MAX_EXTRA_BODY_BYTES = 8 * 1024


class ImageError(Exception):
    """kind：auth、quota、blocked（内容策略）、http、network、bad_response、unsupported。"""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


@dataclass(frozen=True, slots=True)
class ImageConfig:
    model: str
    api_key: str = ""
    base_url: str = ""
    params: Mapping[str, Any] = field(default_factory=dict)

    def size_for(self, aspect: str) -> str:
        sizes = self.params.get("sizes")
        if isinstance(sizes, Mapping) and isinstance(sizes.get(aspect), str):
            return str(sizes[aspect])
        return DEFAULT_SIZES.get(aspect, DEFAULT_SIZES["portrait"])

    def extra_body(self) -> dict[str, Any]:
        extra = self.params.get("extra_body")
        return dict(extra) if isinstance(extra, Mapping) else {}


@dataclass(frozen=True, slots=True)
class Reference:
    data: bytes
    mime: str


@dataclass(frozen=True, slots=True)
class GeneratedImage:
    data: bytes | None = None  # 直接给了图片内容
    url: str | None = None  # 只给了地址，由调用方下载


class ImageProtocol(Protocol):
    id: str
    max_references: int  # 最多带几张参考图；0 表示不支持
    needs_base_url: bool

    async def generate(
        self,
        client: httpx.AsyncClient,
        config: ImageConfig,
        *,
        prompt: str,
        aspect: Aspect,
        count: int,
        references: Sequence[Reference] = (),
    ) -> list[GeneratedImage]: ...


def raise_for(response: httpx.Response, vendor: str) -> None:
    if response.status_code < 400:
        return
    if response.status_code in (401, 403):
        raise ImageError("auth", f"{vendor} rejected the key ({response.status_code})")
    if response.status_code in (402, 429):
        raise ImageError(
            "quota", f"{vendor} is out of quota or rate-limiting ({response.status_code})"
        )
    if response.status_code == 400 and "safety" in response.text.lower():
        raise ImageError("blocked", f"{vendor} refused the prompt (content policy)")
    raise ImageError("http", f"{vendor} returned HTTP {response.status_code}")


def json_of(response: httpx.Response, vendor: str) -> Any:
    try:
        return response.json()
    except ValueError as exc:
        raise ImageError("bad_response", f"{vendor} returned something that isn't JSON") from exc


def decode_b64(value: str) -> bytes:
    if value.startswith("data:"):
        value = value.split(",", 1)[-1]
    try:
        return base64.b64decode(value, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ImageError("bad_response", "The image data isn't valid base64") from exc


def data_url(ref: Reference) -> str:
    return f"data:{ref.mime};base64,{base64.b64encode(ref.data).decode()}"
