"""服务器自己读网页（默认的读法）：走防内网访问的网络层取页面，
在本地用 trafilatura 把 HTML 转成正文。

- 跳转最多 5 次，每一跳的地址都重新检查（SafeTransport 在连接时查 IP）；
- 超时 20 秒，最大 5 MB，只收网页和纯文本；读到二进制内容报错；
- 正文转成 Markdown，内嵌的 base64 图片换成占位。读出来是空的（页面靠 JS 渲染）报 empty，
  配了读网页的服务商时由调用方换它再读。
"""

from __future__ import annotations

import asyncio

import httpx
import trafilatura

from .base import Page, WebError
from .pagetext import looks_binary, strip_inline_images

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT_S = 20.0
_TEXT_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "text/markdown")


async def fetch_page(client: httpx.AsyncClient, url: str) -> Page:
    current = url
    try:
        async with asyncio.timeout(TIMEOUT_S):
            for _ in range(MAX_REDIRECTS + 1):
                async with client.stream(
                    "GET",
                    current,
                    headers={"Accept": "text/html,application/xhtml+xml,text/plain;q=0.9"},
                ) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise WebError("http", "Redirect without a location")
                        current = str(response.url.join(location))
                        continue
                    if response.status_code >= 400:
                        raise WebError("http", f"The page returned HTTP {response.status_code}")
                    kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    if kind and not kind.startswith(_TEXT_TYPES):
                        raise WebError("binary", f"Not a web page ({kind})")
                    body = bytearray()
                    async for piece in response.aiter_bytes():
                        body += piece
                        if len(body) > MAX_BYTES:
                            raise WebError("too_large", "The page is larger than 5 MB")
                    encoding = response.encoding or "utf-8"
                    final = str(response.url)
                    break
            else:
                raise WebError("http", "Too many redirects")
    except TimeoutError as exc:
        raise WebError("network", "Reading the page timed out") from exc
    except httpx.HTTPError as exc:
        raise WebError("network", f"Couldn't reach the page: {type(exc).__name__}") from exc
    raw = bytes(body)
    if looks_binary(raw):
        raise WebError("binary", "The content isn't text")
    html = raw.decode(encoding, errors="replace")
    title, content = await asyncio.to_thread(_extract, html, final, kind)
    content = strip_inline_images(content).strip()
    if not content:
        raise WebError("empty", "No readable text on the page (it may need JavaScript)")
    return Page(url=url, final_url=final, title=title, content=content, fetcher="local")


def _extract(html: str, url: str, kind: str) -> tuple[str, str]:
    if kind.startswith(("text/plain", "text/markdown")):
        return "", html
    content = trafilatura.extract(
        html,
        url=url,
        output_format="markdown",
        include_links=False,
        include_images=False,
        include_tables=True,
        favor_recall=True,
    )
    metadata = trafilatura.extract_metadata(html, default_url=url)
    title = (metadata.title if metadata is not None and metadata.title else "") or ""
    return title[:300], content or ""
