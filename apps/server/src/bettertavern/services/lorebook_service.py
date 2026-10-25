"""世界书仓库（docs/lorebook.md）：导入 SillyTavern 的世界书文件、新建空白的、看、改名和简介、
改条目（自动保存，带版本号）、删除（从挂着它的剧本上摘掉，已经开始的故事不受影响）。

条目的结构和卡里的世界书一样；编辑和工作台草稿一样宽松（domain/scenario/lorebook.py）。
同一个用户同一个文件只记一本：再导入时默认返回已有的那本，客户端问是打开它还是另外导入一份。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.scenario.card import LoreEntry
from bettertavern.domain.scenario.edit import EditError, LoreEntryEdit
from bettertavern.domain.scenario.lorebook import (
    MAX_LOREBOOK_DESCRIPTION_CHARS,
    MAX_LOREBOOK_NAME_CHARS,
    edit_book,
)
from bettertavern.importers.lorebook import LorebookError, import_lorebook
from bettertavern.infra.db.repositories import lorebooks as repo
from bettertavern.infra.db.sqlutil import is_uuid

from .card_service import strip_nul
from .errors import Conflict, Invalid, NotFound
from .quotas import Quotas, check_lorebooks, lock_user

log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class LorebookSummary:
    id: str
    name: str
    description: str
    source: str
    entries: int
    constant: int
    scenario_count: int
    report: dict[str, Any] | None  # 导入报告；新建的没有
    version: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class LorebookDetail:
    summary: LorebookSummary
    book: tuple[LoreEntry, ...]  # 按 order 排好
    scenarios: list[tuple[str, str]]  # 挂着它的剧本 (id, 名字)


@dataclass(frozen=True, slots=True)
class LorebookImport:
    lorebook: LorebookDetail | None
    existing: LorebookSummary | None  # 同一个文件导入过、又没让另起一份时


def summary_of(row: repo.LorebookRow) -> LorebookSummary:
    return LorebookSummary(
        id=row.id,
        name=row.name,
        description=row.description,
        source=row.source,
        entries=row.entries,
        constant=row.constant,
        scenario_count=row.scenario_count,
        report=row.report or None,
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def book_of(row: repo.LorebookRow) -> tuple[LoreEntry, ...]:
    entries = (LoreEntry.model_validate(e) for e in row.book or [])
    return tuple(sorted(entries, key=lambda e: e.order))


def _dump(book: Sequence[LoreEntry]) -> list[dict[str, Any]]:
    return [strip_nul(e.model_dump(mode="json")) for e in book]


def _name(value: str) -> str:
    name = " ".join(strip_nul(value).split())
    if not name:
        raise Invalid("The name can't be empty", field="name")
    if len(name) > MAX_LOREBOOK_NAME_CHARS:
        raise Invalid(f"The name can be at most {MAX_LOREBOOK_NAME_CHARS} characters", field="name")
    return name


def _description(value: str) -> str:
    text = strip_nul(value).replace("\r\n", "\n").strip()
    if len(text) > MAX_LOREBOOK_DESCRIPTION_CHARS:
        raise Invalid(
            f"The description can be at most {MAX_LOREBOOK_DESCRIPTION_CHARS} characters",
            field="description",
        )
    return text


def _changed(version: int) -> Conflict:
    return Conflict(
        "This lorebook was changed somewhere else; reload it",
        code="LOREBOOK_CHANGED",
        version=version,
    )


class LorebookService:
    def __init__(self, engine: AsyncEngine, quotas: Quotas | None = None) -> None:
        self._engine = engine
        self._quotas = quotas or Quotas()

    async def _detail(self, conn: Any, row: repo.LorebookRow) -> LorebookDetail:
        scenarios = await repo.scenarios_using(conn, row.id)
        return LorebookDetail(summary=summary_of(row), book=book_of(row), scenarios=scenarios)

    async def list(self, user_id: str) -> list[LorebookSummary]:
        async with self._engine.connect() as conn:
            rows = await repo.list_lorebooks(conn, user_id)
        return [summary_of(r) for r in rows]

    async def get(self, user_id: str, lorebook_id: str) -> LorebookDetail:
        if not is_uuid(lorebook_id):
            raise NotFound("Lorebook not found")
        async with self._engine.connect() as conn:
            row = await repo.get_lorebook(conn, user_id, lorebook_id)
            if row is None:
                raise NotFound("Lorebook not found")
            return await self._detail(conn, row)

    async def create(self, user_id: str, *, name: str, description: str = "") -> LorebookDetail:
        clean_name, clean_description = _name(name), _description(description)
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            await check_lorebooks(conn, user_id, self._quotas)
            row = await repo.insert_lorebook(
                conn,
                user_id=user_id,
                name=clean_name,
                description=clean_description,
                source="manual",
                source_sha256=None,
                raw=None,
                book=[],
                report={},
            )
            detail = await self._detail(conn, row)
        log.info("lorebook.created", lorebook_id=row.id)
        return detail

    async def import_file(
        self, user_id: str, data: bytes, *, filename: str, allow_duplicate: bool
    ) -> LorebookImport:
        started = time.perf_counter()
        try:
            # 解析、试编译正则放到线程里，不占用事件循环
            imported = await asyncio.to_thread(import_lorebook, data, filename=filename)
        except LorebookError as exc:
            log.info("lorebook.import_failed", bytes=len(data), code=exc.code, reason=str(exc))
            code = "LOREBOOK_IS_CARD" if exc.code == "is_card" else "LOREBOOK_INVALID"
            raise Invalid(f"Couldn't import the lorebook: {exc}", code=code) from exc
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            existing = await repo.find_by_sha(conn, user_id, imported.sha256)
            if existing is not None and not allow_duplicate:
                log.info("lorebook.imported", duplicate=True, lorebook_id=existing.id)
                return LorebookImport(lorebook=None, existing=summary_of(existing))
            await check_lorebooks(conn, user_id, self._quotas)
            row = await repo.insert_lorebook(
                conn,
                user_id=user_id,
                name=strip_nul(imported.name),
                description=strip_nul(imported.description),
                source=imported.source,
                # 同一个文件已经有一本了：另外导入的这本不记文件指纹
                source_sha256=None if existing is not None else imported.sha256,
                raw=strip_nul(imported.raw),
                book=_dump(imported.book),
                report=imported.report.model_dump(mode="json"),
            )
            detail = await self._detail(conn, row)
        report = imported.report
        log.info(
            "lorebook.imported",
            lorebook_id=row.id,
            duplicate=existing is not None,
            bytes=len(data),
            source=imported.source,
            entries=report.entries,
            dropped=report.dropped_empty + report.dropped_unreachable + report.dropped_over_limit,
            unsupported=report.vectorized + report.character_filter + report.bad_regex,
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return LorebookImport(lorebook=detail, existing=None)

    async def update_meta(
        self,
        user_id: str,
        lorebook_id: str,
        *,
        name: str | None,
        description: str | None,
        version: int | None,
    ) -> LorebookDetail:
        if not is_uuid(lorebook_id):
            raise NotFound("Lorebook not found")
        async with self._engine.begin() as conn:
            row = await repo.get_lorebook(conn, user_id, lorebook_id, lock=True)
            if row is None:
                raise NotFound("Lorebook not found")
            if version is not None and version != row.version:
                raise _changed(row.version)
            updated = await repo.update_meta(
                conn,
                user_id,
                lorebook_id,
                name=_name(name) if name is not None else row.name,
                description=_description(description)
                if description is not None
                else row.description,
                expected_version=row.version,
            )
            assert updated is not None  # 已经锁住了这一行
            return await self._detail(conn, updated)

    async def update_book(
        self, user_id: str, lorebook_id: str, *, version: int, entries: Sequence[LoreEntryEdit]
    ) -> LorebookDetail:
        """编辑条目的自动保存：整本的条目，宽松模式；超过上限拒绝并指出字段。"""
        if not is_uuid(lorebook_id):
            raise NotFound("Lorebook not found")
        try:
            book = edit_book(entries)
        except EditError as exc:
            raise Invalid(exc.message, field=exc.field) from exc
        async with self._engine.begin() as conn:
            updated = await repo.update_book(
                conn, user_id, lorebook_id, book=_dump(book), expected_version=version
            )
            if updated is None:
                row = await repo.get_lorebook(conn, user_id, lorebook_id)
                if row is None:
                    raise NotFound("Lorebook not found")
                raise _changed(row.version)
            return await self._detail(conn, updated)

    async def delete(self, user_id: str, lorebook_id: str) -> None:
        if not is_uuid(lorebook_id):
            raise NotFound("Lorebook not found")
        async with self._engine.begin() as conn:
            if not await repo.delete_lorebook(conn, user_id, lorebook_id):
                raise NotFound("Lorebook not found")
        log.info("lorebook.deleted", lorebook_id=lorebook_id)
