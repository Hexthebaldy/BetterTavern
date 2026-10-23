"""WebStore 的 Postgres 实现：worker 里的工作台 agent 通过它读写网页缓存、资料笔记，
存搜到的、生成的图，记官方搜索的次数。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.infra.db.repositories import credits as usage_repo
from bettertavern.infra.db.repositories import drafts as drafts_repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import web as repo
from bettertavern.runtime.ports import NewImage, StorageFull, StoredPage, WorkbenchAsset

from .quotas import Quotas, lock_user, storage_left


def _page(row: repo.PageRow) -> StoredPage:
    return StoredPage(
        id=row.id,
        url=row.url,
        final_url=row.final_url,
        title=row.title,
        content=row.content,
        fetcher=row.fetcher,
    )


class PgWebStore:
    def __init__(self, engine: AsyncEngine, quotas: Quotas | None = None) -> None:
        self._engine = engine
        self._quotas = quotas or Quotas()

    async def cached_page(
        self, user_id: str, url_hash: str, *, max_age_s: int
    ) -> StoredPage | None:
        async with self._engine.connect() as conn:
            row = await repo.cached_page(conn, user_id, url_hash, max_age_s=max_age_s)
        return None if row is None else _page(row)

    async def save_page(
        self,
        user_id: str,
        *,
        url: str,
        url_hash: str,
        final_url: str | None,
        title: str,
        content: str,
        fetcher: str,
    ) -> str:
        async with self._engine.begin() as conn:
            return await repo.insert_page(
                conn,
                user_id,
                url=url,
                url_hash=url_hash,
                final_url=final_url,
                title=title.replace("\x00", ""),
                content=content.replace("\x00", ""),
                fetcher=fetcher,
            )

    async def page(self, user_id: str, page_id: str) -> StoredPage | None:
        async with self._engine.connect() as conn:
            row = await repo.get_page(conn, user_id, page_id)
        return None if row is None else _page(row)

    async def claim_platform_search(self, user_id: str) -> bool:
        """官方搜索记一次：全站这个月、这个用户今天都还有次数时记下并返回 True。
        两个上限之间没有锁，几个请求同时来可能超出月上限几次（上限本来就比免费额度少一截）。"""
        async with self._engine.begin() as conn:
            used = await usage_repo.month_usage(conn, "search")
            if used >= self._quotas.platform_searches_per_month:
                return False
            return await usage_repo.add_usage(
                conn, user_id, "search", daily_limit=self._quotas.platform_searches_per_day
            )

    async def add_note(
        self, draft_id: str, *, text: str, source: Mapping[str, Any], used_in: Sequence[str]
    ) -> str:
        async with self._engine.begin() as conn:
            return await repo.insert_note(conn, draft_id, text=text, source=source, used_in=used_in)

    async def list(self, conn: AsyncConnection, draft_id: str) -> list[repo.NoteRow]:
        """PgWorkbenchStore 拼上下文时读笔记（在它的连接里）。"""
        return await repo.list_notes(conn, draft_id)

    async def add_image(
        self,
        user_id: str,
        draft_id: str,
        image: NewImage,
        *,
        source: str,
        license: str,
        source_url: str | None = None,
        prompt: str | None = None,
        meta: Mapping[str, Any] | None = None,
    ) -> WorkbenchAsset:
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            if await storage_left(conn, user_id, self._quotas) < len(image.data):
                raise StorageFull
            blob_id = await library_repo.insert_blob(
                conn,
                user_id=user_id,
                sha256=image.sha256,
                mime=image.mime,
                data=image.data,
                width=image.width,
                height=image.height,
            )
            row = await drafts_repo.insert_asset(
                conn,
                user_id=user_id,
                draft_id=draft_id,
                blob_id=blob_id,
                source=source,
                license=license,
                source_url=source_url,
                prompt=prompt,
                meta=dict(meta or {}),
            )
        return WorkbenchAsset(
            id=row.id,
            blob_id=row.blob_id,
            source=row.source,
            license=row.license,
            source_url=row.source_url,
            prompt=row.prompt,
            width=row.width,
            height=row.height,
            meta=row.meta,
        )

    async def image_bytes(self, user_id: str, blob_id: str) -> tuple[bytes, str] | None:
        async with self._engine.connect() as conn:
            blob = await library_repo.get_blob(conn, user_id, blob_id)
        return None if blob is None else (blob.data, blob.mime)
