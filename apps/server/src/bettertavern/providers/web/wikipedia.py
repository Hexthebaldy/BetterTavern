"""维基百科的搜索：不用 Key 的兜底（docs/workbench.md 第 5 节）。

没配搜索服务、官方搜索的次数用完时，工作台 agent 用它查资料。

用维基百科自己的搜索接口（MediaWiki 的 list=search），只搜维基百科：
- 按 params["lang"]（zh / en / ja）选站点，这一站一条也没搜到时再搜英文站；
- 中文站给的地址用简体（/zh-cn/），读网页时拿到的就是简体正文；
- 维基媒体要求请求带上能找到项目的 User-Agent。

不在 WEB_PROVIDERS 里：用户不能把它配成自己的搜索服务，只作为内置的兜底。
"""

from __future__ import annotations

import html
import re
from urllib.parse import quote

import httpx

from .base import SearchHit, Unsupported, WebConfig, WebError, json_of, raise_for, text

LANGUAGES = ("zh", "en", "ja")
USER_AGENT = "BetterTavern/1.0 (https://github.com/Hexthebaldy/BetterTavern)"
_TAG = re.compile(r"<[^>]+>")


def page_url(lang: str, title: str) -> str:
    path = "zh-cn" if lang == "zh" else "wiki"
    return f"https://{lang}.wikipedia.org/{path}/{quote(title.replace(' ', '_'))}"


class Wikipedia(Unsupported):
    id = "wikipedia"
    can_search = True
    can_images = False
    can_fetch = False
    needs_key = False
    needs_base_url = False

    async def _search_site(
        self, client: httpx.AsyncClient, lang: str, query: str, count: int
    ) -> list[SearchHit]:
        response = await client.get(
            f"https://{lang}.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srlimit": str(max(1, min(count, 10))),
                "srprop": "snippet",
                "format": "json",
                "formatversion": "2",
            },
            headers={"User-Agent": USER_AGENT},
        )
        raise_for(response, "Wikipedia")
        data = json_of(response, "Wikipedia")
        items = data.get("query", {}).get("search") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise WebError("bad_response", "Wikipedia returned an unexpected shape")
        return [
            SearchHit(
                title=text(item["title"], 200),
                url=page_url(lang, str(item["title"])),
                snippet=text(html.unescape(_TAG.sub("", str(item.get("snippet") or "")))),
            )
            for item in items
            if isinstance(item, dict) and item.get("title")
        ][:count]

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]:
        lang = str(config.params.get("lang") or "en")
        if lang not in LANGUAGES:
            lang = "en"
        hits = await self._search_site(client, lang, query, count)
        if not hits and lang != "en":
            hits = await self._search_site(client, "en", query, count)
        return hits
