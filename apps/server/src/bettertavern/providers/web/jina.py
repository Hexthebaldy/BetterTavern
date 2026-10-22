"""Jina Reader：替我们读网页（给依赖 JS 渲染的页面用）。https://jina.ai/reader"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from .base import ImageHit, Page, SearchHit, WebConfig, WebError, json_of, raise_for, text

BASE = "https://r.jina.ai"


class Jina:
    id = "jina"
    can_search = False
    can_images = False
    can_fetch = True
    needs_key = False  # 没有 Key 也能用，限流更严
    needs_base_url = False

    async def search(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[SearchHit]:
        raise WebError("unsupported", "Jina Reader can't search")

    async def images(
        self, client: httpx.AsyncClient, config: WebConfig, query: str, count: int
    ) -> list[ImageHit]:
        raise WebError("unsupported", "Jina Reader can't search images")

    async def fetch(
        self, client: httpx.AsyncClient, config: WebConfig, urls: Sequence[str]
    ) -> list[Page | WebError]:
        pages: list[Page | WebError] = []
        headers = {"Accept": "application/json", "X-Return-Format": "markdown"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"
        for url in urls:
            try:
                response = await client.post(
                    f"{config.base_url or BASE}/", json={"url": url}, headers=headers
                )
                raise_for(response, "Jina")
                data = json_of(response, "Jina")
            except WebError as exc:
                pages.append(exc)
                continue
            inner = data.get("data") if isinstance(data, dict) else None
            content = inner.get("content") if isinstance(inner, dict) else None
            if not isinstance(content, str) or not content.strip():
                pages.append(WebError("empty", "Jina couldn't read this page"))
                continue
            assert isinstance(inner, dict)
            pages.append(
                Page(
                    url=url,
                    final_url=str(inner.get("url") or url),
                    title=text(inner.get("title"), 300),
                    content=content,
                    fetcher=self.id,
                )
            )
        return pages
