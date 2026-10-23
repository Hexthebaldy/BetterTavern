"""联网的服务商：搜索、搜图、读网页（docs/workbench.md 第 5 节）。

和 providers 的其他部分一样不 import 本项目的其他包；出站请求都走 transport.py 的防内网访问网络层。
读网页默认由服务器自己读（local.py），服务商只作为可选项。
维基百科的搜索（wikipedia.py）不用 Key，是内置的兜底，不在 WEB_PROVIDERS 里
（用户不能把它配成自己的服务）。
"""

from __future__ import annotations

from .base import ImageHit, Page, SearchHit, WebConfig, WebError, WebProvider
from .bocha import Bocha
from .brave import Brave
from .download import MAX_DOWNLOAD_BYTES, download_image
from .jina import Jina
from .local import fetch_page
from .pagetext import clip_page, read_lines, secret_in_url, strip_inline_images
from .searxng import SearXNG
from .tavily import Tavily
from .wikipedia import Wikipedia

WEB_PROVIDERS: dict[str, WebProvider] = {
    p.id: p for p in (Tavily(), Brave(), SearXNG(), Bocha(), Jina())
}
WIKIPEDIA: WebProvider = Wikipedia()

__all__ = [
    "MAX_DOWNLOAD_BYTES",
    "WEB_PROVIDERS",
    "WIKIPEDIA",
    "ImageHit",
    "Page",
    "SearchHit",
    "WebConfig",
    "WebError",
    "WebProvider",
    "clip_page",
    "download_image",
    "fetch_page",
    "read_lines",
    "secret_in_url",
    "strip_inline_images",
]
