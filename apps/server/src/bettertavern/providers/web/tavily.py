"""Tavily：搜索、搜图（搜索结果里带图片）、读网页（extract）。https://docs.tavily.com"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from .base import ImageHit, Page, SearchHit, WebConfig, WebError, json_of, raise_for, text

BASE = "https://api.tavily.com"


class Tavily:
    id = "tavily"
    can_search = True
    can_images = True
    can_fetch = True
    needs_key = True
    needs_base_url = False

    def _headers(self, config: WebConfig) -> dict[str, str]:
        return {"Authorization": f"Bearer {config.api_key}"}

    async def _search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int, images: bool
    ) -> dict:
        body = {
            "query": query,
            "max_results": max(1, min(count, 10)),
            "search_depth": "basic",
            "include_images": images,
            "include_image_descriptions": images,
        }
        if config.params.get("country"):
            body["country"] = str(config.params["country"])
        response = await client.post(
            f"{config.base_url or BASE}/search", json=body, headers=self._headers(config)
        )
        raise_for(response, "Tavily")
        data = json_of(response, "Tavily")
        if not isinstance(data, dict):
            raise WebError("bad_response", "Tavily returned an unexpected shape")
        return data

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]:
        data = await self._search(client, config, query, count, images=False)
        return [
            SearchHit(
                title=text(r.get("title"), 200), url=str(r["url"]), snippet=text(r.get("content"))
            )
            for r in data.get("results") or []
            if isinstance(r, dict) and r.get("url")
        ][:count]

    async def images(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[ImageHit]:
        data = await self._search(client, config, query, count, images=True)
        hits: list[ImageHit] = []
        for item in data.get("images") or []:
            if isinstance(item, str):
                hits.append(ImageHit(image_url=item))
            elif isinstance(item, dict) and item.get("url"):
                hits.append(
                    ImageHit(image_url=str(item["url"]), title=text(item.get("description"), 200))
                )
        return hits[:count]

    async def fetch(
        self, client: httpx.AsyncClient, config: WebConfig, urls: Sequence[str]
    ) -> list[Page | WebError]:
        response = await client.post(
            f"{config.base_url or BASE}/extract",
            json={"urls": list(urls), "format": "markdown"},
            headers=self._headers(config),
        )
        raise_for(response, "Tavily")
        data = json_of(response, "Tavily")
        found = {
            str(r.get("url")): r
            for r in (data.get("results") or [] if isinstance(data, dict) else [])
            if isinstance(r, dict)
        }
        pages: list[Page | WebError] = []
        for url in urls:
            item = found.get(url)
            content = item.get("raw_content") if item else None
            if not isinstance(content, str) or not content.strip():
                pages.append(WebError("empty", "Tavily couldn't read this page"))
                continue
            pages.append(Page(url=url, final_url=url, title="", content=content, fetcher=self.id))
        return pages
