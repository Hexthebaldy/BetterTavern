"""博查（Bocha）：搜索、搜图，国内能直接用。https://open.bochaai.com"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from .base import ImageHit, Page, SearchHit, WebConfig, WebError, as_int, json_of, raise_for, text

BASE = "https://api.bochaai.com/v1"


class Bocha:
    id = "bocha"
    can_search = True
    can_images = True
    can_fetch = False
    needs_key = True
    needs_base_url = False

    async def _search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> dict:
        response = await client.post(
            f"{config.base_url or BASE}/web-search",
            json={"query": query, "summary": True, "count": max(1, min(count, 20))},
            headers={"Authorization": f"Bearer {config.api_key}"},
        )
        raise_for(response, "Bocha")
        data = json_of(response, "Bocha")
        if not isinstance(data, dict):
            raise WebError("bad_response", "Bocha returned an unexpected shape")
        code = data.get("code")
        if code not in (None, 200, "200"):
            kind = "auth" if code in (401, 403, "401", "403") else "http"
            raise WebError(kind, f"Bocha returned code {code}")
        inner = data.get("data")
        return inner if isinstance(inner, dict) else {}

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]:
        data = await self._search(client, config, query, count)
        pages = (data.get("webPages") or {}).get("value") or []
        return [
            SearchHit(
                title=text(r.get("name"), 200),
                url=str(r["url"]),
                snippet=text(r.get("summary") or r.get("snippet")),
            )
            for r in pages
            if isinstance(r, dict) and r.get("url")
        ][:count]

    async def images(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[ImageHit]:
        data = await self._search(client, config, query, count)
        values = (data.get("images") or {}).get("value") or []
        return [
            ImageHit(
                image_url=str(r["contentUrl"]),
                page_url=str(r.get("hostPageUrl") or ""),
                thumb_url=str(r.get("thumbnailUrl") or ""),
                title=text(r.get("name"), 200),
                width=as_int(r.get("width")),
                height=as_int(r.get("height")),
            )
            for r in values
            if isinstance(r, dict) and r.get("contentUrl")
        ][:count]

    async def fetch(
        self, client: httpx.AsyncClient, config: WebConfig, urls: Sequence[str]
    ) -> list[Page | WebError]:
        raise WebError("unsupported", "Bocha can't read pages")
