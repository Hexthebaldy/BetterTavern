"""Brave Search：搜索、搜图。https://api-dashboard.search.brave.com/app/documentation"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from .base import ImageHit, Page, SearchHit, WebConfig, WebError, as_int, json_of, raise_for, text

BASE = "https://api.search.brave.com/res/v1"


class Brave:
    id = "brave"
    can_search = True
    can_images = True
    can_fetch = False
    needs_key = True
    needs_base_url = False

    def _params(self, config: WebConfig, query: str, count: int) -> dict[str, str]:
        params = {"q": query, "count": str(max(1, min(count, 20)))}
        for key in ("country", "search_lang", "safesearch"):
            if config.params.get(key):
                params[key] = str(config.params[key])
        return params

    async def _get(
        self, client: httpx.AsyncClient, config: WebConfig, path: str, params: dict
    ) -> dict:
        response = await client.get(
            f"{config.base_url or BASE}/{path}",
            params=params,
            headers={"X-Subscription-Token": config.api_key, "Accept": "application/json"},
        )
        raise_for(response, "Brave")
        data = json_of(response, "Brave")
        if not isinstance(data, dict):
            raise WebError("bad_response", "Brave returned an unexpected shape")
        return data

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]:
        data = await self._get(client, config, "web/search", self._params(config, query, count))
        results = (data.get("web") or {}).get("results") or []
        return [
            SearchHit(
                title=text(r.get("title"), 200),
                url=str(r["url"]),
                snippet=text(r.get("description")),
            )
            for r in results
            if isinstance(r, dict) and r.get("url")
        ][:count]

    async def images(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[ImageHit]:
        data = await self._get(client, config, "images/search", self._params(config, query, count))
        hits: list[ImageHit] = []
        for r in data.get("results") or []:
            if not isinstance(r, dict):
                continue
            props = r.get("properties") or {}
            image = props.get("url") if isinstance(props, dict) else None
            if not image:
                continue
            thumb = (
                (r.get("thumbnail") or {}).get("src", "")
                if isinstance(r.get("thumbnail"), dict)
                else ""
            )
            hits.append(
                ImageHit(
                    image_url=str(image),
                    page_url=str(r.get("url") or ""),
                    thumb_url=str(thumb or ""),
                    title=text(r.get("title"), 200),
                    width=as_int(props.get("width")),
                    height=as_int(props.get("height")),
                )
            )
        return hits[:count]

    async def fetch(
        self, client: httpx.AsyncClient, config: WebConfig, urls: Sequence[str]
    ) -> list[Page | WebError]:
        raise WebError("unsupported", "Brave can't read pages")
