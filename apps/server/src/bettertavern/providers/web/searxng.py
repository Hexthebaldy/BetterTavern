"""SearXNG：自己架的元搜索，免费、不用 Key。实例要在 settings.yml 里打开 json 格式。https://docs.searxng.org"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from .base import ImageHit, Page, SearchHit, WebConfig, WebError, json_of, raise_for, text


class SearXNG:
    id = "searxng"
    can_search = True
    can_images = True
    can_fetch = False
    needs_key = False
    needs_base_url = True

    async def _get(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, category: str
    ) -> list[dict]:
        if not config.base_url:
            raise WebError("bad_config", "SearXNG needs the instance address")
        params = {"q": query, "format": "json", "categories": category}
        if config.params.get("language"):
            params["language"] = str(config.params["language"])
        if config.params.get("safesearch") is not None:
            params["safesearch"] = str(config.params["safesearch"])
        headers = {"Authorization": f"Bearer {config.api_key}"} if config.api_key else {}
        response = await client.get(
            f"{config.base_url.rstrip('/')}/search", params=params, headers=headers
        )
        raise_for(response, "SearXNG")
        data = json_of(response, "SearXNG")
        if not isinstance(data, dict):
            raise WebError("bad_response", "SearXNG returned an unexpected shape")
        return [r for r in data.get("results") or [] if isinstance(r, dict)]

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]:
        results = await self._get(client, config, query, "general")
        return [
            SearchHit(
                title=text(r.get("title"), 200), url=str(r["url"]), snippet=text(r.get("content"))
            )
            for r in results
            if r.get("url")
        ][:count]

    async def images(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[ImageHit]:
        results = await self._get(client, config, query, "images")
        hits: list[ImageHit] = []
        for r in results:
            if not r.get("img_src"):
                continue
            width = height = None
            resolution = str(r.get("resolution") or "")
            if "x" in resolution.replace("×", "x"):
                parts = resolution.replace("×", "x").split("x")
                if len(parts) == 2 and parts[0].strip().isdigit() and parts[1].strip().isdigit():
                    width, height = int(parts[0]), int(parts[1])
            hits.append(
                ImageHit(
                    image_url=str(r["img_src"]),
                    page_url=str(r.get("url") or ""),
                    thumb_url=str(r.get("thumbnail_src") or ""),
                    title=text(r.get("title"), 200),
                    width=width,
                    height=height,
                )
            )
        return hits[:count]

    async def fetch(
        self, client: httpx.AsyncClient, config: WebConfig, urls: Sequence[str]
    ) -> list[Page | WebError]:
        raise WebError("unsupported", "SearXNG can't read pages")
