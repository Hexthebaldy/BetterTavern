"""下载一张网上的图（搜到的图、文生图返回的地址）：经防内网访问的网络层，只收图片，最大 10 MB。"""

from __future__ import annotations

import httpx

from .base import WebError

MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
# 有的图床不标图片类型，只标“二进制”（硅基流动的 s3.siliconflow.cn 就是）：这时看文件开头认图
UNTYPED = frozenset({"", "application/octet-stream", "binary/octet-stream"})


def looks_like_image(data: bytes | bytearray) -> bool:
    """文件开头是不是 PNG、JPEG 或 WebP（后面存图只认这三种）。"""
    return (
        data.startswith(b"\x89PNG\r\n\x1a\n")
        or data.startswith(b"\xff\xd8\xff")
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


def unusable_reason(exc: BaseException) -> str:
    """一张图下载或解码失败的原因，写日志和回给 agent 用：只有种类和固定说明，不带地址。"""
    if isinstance(exc, WebError):
        return f"{exc.kind}: {exc.message}"
    if isinstance(exc, httpx.HTTPError):
        return type(exc).__name__
    return str(exc)[:200] or type(exc).__name__


async def download_image(client: httpx.AsyncClient, url: str) -> bytes:
    """经防内网访问的网络层下载一张图：跳转最多 3 次，只收图片，最大 10 MB。"""
    current = url
    for _ in range(4):
        async with client.stream("GET", current, headers={"Accept": "image/*"}) as response:
            if response.is_redirect and response.headers.get("location"):
                current = str(response.url.join(response.headers["location"]))
                continue
            if response.status_code >= 400:
                raise WebError("http", f"The image returned HTTP {response.status_code}")
            kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if not kind.startswith("image/") and kind not in UNTYPED:
                raise WebError("binary", f"Not an image ({kind})")
            body = bytearray()
            async for piece in response.aiter_bytes():
                body += piece
                if len(body) > MAX_DOWNLOAD_BYTES:
                    raise WebError("too_large", "The image is larger than 10 MB")
            if not kind.startswith("image/") and not looks_like_image(body):
                raise WebError("binary", "Not an image")
            return bytes(body)
    raise WebError("http", "Too many redirects")
