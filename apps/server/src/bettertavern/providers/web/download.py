"""下载一张网上的图（搜到的图、文生图返回的地址）：经防内网访问的网络层，只收图片，最大 10 MB。"""

from __future__ import annotations

import httpx

from .base import WebError

MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024


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
            if kind and not kind.startswith("image/"):
                raise WebError("binary", f"Not an image ({kind})")
            body = bytearray()
            async for piece in response.aiter_bytes():
                body += piece
                if len(body) > MAX_DOWNLOAD_BYTES:
                    raise WebError("too_large", "The image is larger than 10 MB")
            return bytes(body)
    raise WebError("http", "Too many redirects")
