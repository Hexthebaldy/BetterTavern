"""角色卡仓库：列表、详情、删除（有剧本在用时拒绝）、版本历史和恢复、导出，以及读图片。

卡只从工作台保存进来（draft_service.py）；这里不负责改卡的内容。
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.scenario.card import CharacterCard, display_text
from bettertavern.domain.scenario.edit import book_in_order
from bettertavern.importers.character_card.export import card_v2, card_v3, embed_card
from bettertavern.importers.images import cover_png
from bettertavern.infra.db.repositories import cards as repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.sqlutil import is_uuid

from .errors import Conflict, NotFound

log = structlog.get_logger(__name__)

PREVIEW_CHARS = 280


@dataclass(frozen=True, slots=True)
class CardSummary:
    id: str
    name: str
    character_name: str
    source: str
    cover_blob_id: str | None
    description_preview: str
    creator: str
    tags: list[str]
    book_entries: int
    greetings: int
    made_by: str
    ip: dict[str, Any] | None
    scenario_count: int
    draft_id: str | None
    version: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class CardDetail:
    summary: CardSummary
    card: CharacterCard  # 世界书按 order 排好
    meta: dict[str, Any]
    scenarios: list[tuple[str, str]]  # 在用的剧本 (id, 名字)


@dataclass(frozen=True, slots=True)
class RevisionView:
    version: int
    name: str
    note: str
    cover_blob_id: str | None
    from_draft: bool
    created_at: datetime


@dataclass(frozen=True, slots=True)
class BlobView:
    mime: str
    data: bytes
    sha256: str


@dataclass(frozen=True, slots=True)
class ExportedCard:
    data: bytes
    mime: str
    filename: str


def strip_nul(value: Any) -> Any:
    """Postgres 的 JSONB 和 TEXT 不接受 \\u0000：递归去掉。"""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [strip_nul(v) for v in value]
    if isinstance(value, dict):
        return {strip_nul(str(k)): strip_nul(v) for k, v in value.items()}
    return value


def preview(text: str, *, char: str) -> str:
    # 先合并空白，跨行写的 *动作* 也能认出来
    text = display_text(" ".join(text.split()), char=char)
    return text if len(text) <= PREVIEW_CHARS else text[:PREVIEW_CHARS] + "…"


def card_of(row: repo.CardRow) -> CharacterCard:
    return CharacterCard.model_validate(row.card)


def summary_of(row: repo.CardRow) -> CardSummary:
    card = card_of(row)
    ip = row.meta.get("ip")
    return CardSummary(
        id=row.id,
        name=row.name,
        character_name=card.name,
        source=row.source,
        cover_blob_id=row.cover_blob_id,
        description_preview=preview(card.description, char=card.name or row.name),
        creator=card.creator,
        tags=list(card.tags),
        book_entries=len(card.book),
        greetings=(1 if card.first_mes.strip() else 0) + len(card.alternate_greetings),
        made_by=str(row.meta.get("made_by") or ("agent" if row.source == "agent" else "manual")),
        ip=ip if isinstance(ip, dict) else None,
        scenario_count=row.scenario_count,
        draft_id=row.draft_id,
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _filename(name: str, ext: str) -> str:
    safe = "".join(ch for ch in name if ch.isalnum() or ch in " -_").strip() or "card"
    return f"{safe[:60]}.{ext}"


class CardService:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def list(self, user_id: str) -> list[CardSummary]:
        async with self._engine.connect() as conn:
            rows = await repo.list_cards(conn, user_id)
        return [summary_of(r) for r in rows]

    async def _row(self, user_id: str, card_id: str) -> repo.CardRow:
        if not is_uuid(card_id):
            raise NotFound("Character card not found")
        async with self._engine.connect() as conn:
            row = await repo.get_card(conn, user_id, card_id)
        if row is None:
            raise NotFound("Character card not found")
        return row

    async def get(self, user_id: str, card_id: str) -> CardDetail:
        row = await self._row(user_id, card_id)
        async with self._engine.connect() as conn:
            scenarios = await repo.scenarios_using(conn, row.id)
        card = card_of(row)
        return CardDetail(
            summary=summary_of(row),
            card=card.model_copy(update={"book": book_in_order(card.book)}),
            meta=row.meta,
            scenarios=scenarios,
        )

    async def delete(self, user_id: str, card_id: str) -> None:
        if not is_uuid(card_id):
            raise NotFound("Character card not found")
        async with self._engine.begin() as conn:
            row = await repo.get_card(conn, user_id, card_id, lock=True)
            if row is None:
                raise NotFound("Character card not found")
            using = await repo.scenarios_using(conn, card_id)
            if using:
                raise Conflict(
                    "This character card is used by a scenario; delete or change those first",
                    code="CARD_IN_USE",
                    scenarios=[{"id": sid, "name": name} for sid, name in using],
                )
            blobs = await repo.delete_card(conn, user_id, card_id)
            await library_repo.delete_orphan_blobs(conn, user_id, blobs or [])
        log.info("card.deleted", card_id=card_id)

    async def revisions(self, user_id: str, card_id: str) -> list[RevisionView]:
        row = await self._row(user_id, card_id)
        async with self._engine.connect() as conn:
            revisions = await repo.list_revisions(conn, row.id)
        return [
            RevisionView(
                version=r.version,
                name=r.name,
                note=r.note,
                cover_blob_id=r.cover_blob_id,
                from_draft=r.draft_id is not None,
                created_at=r.created_at,
            )
            for r in revisions
        ]

    async def restore(self, user_id: str, card_id: str, version: int) -> CardDetail:
        """把某个旧版本恢复成最新版：算一次新的保存（版本号加 1，记一份新的版本）。"""
        if not is_uuid(card_id):
            raise NotFound("Character card not found")
        async with self._engine.begin() as conn:
            row = await repo.get_card(conn, user_id, card_id, lock=True)
            if row is None:
                raise NotFound("Character card not found")
            revision = await repo.get_revision(conn, card_id, version)
            if revision is None:
                raise NotFound("That version no longer exists")
            updated = await repo.update_card(
                conn,
                user_id,
                card_id,
                name=revision.name,
                card=revision.card,
                cover_blob_id=revision.cover_blob_id,
                meta=row.meta,
                expected_version=row.version,
            )
            assert updated is not None  # 已经锁住了这一行
            dropped = await repo.insert_revision(
                conn, card=updated, draft_id=None, note=f"restore:{version}"
            )
            await library_repo.delete_orphan_blobs(conn, user_id, dropped)
        log.info("card.restored", card_id=card_id, from_version=version, version=updated.version)
        return await self.get(user_id, card_id)

    async def export(self, user_id: str, card_id: str, fmt: Literal["png", "json"]) -> ExportedCard:
        row = await self._row(user_id, card_id)
        async with self._engine.connect() as conn:
            raw = await repo.get_card_raw(conn, user_id, card_id)
            cover = (
                await library_repo.get_blob(conn, user_id, row.cover_blob_id)
                if row.cover_blob_id
                else None
            )
        card = card_of(row)
        extra = {"card_id": row.id, "version": row.version, **row.meta}
        v3 = card_v3(card, raw=raw, extra=extra)
        if fmt == "json":
            data = json.dumps(v3, ensure_ascii=False, indent=2).encode("utf-8")
            return ExportedCard(data, "application/json", _filename(row.name, "json"))
        v2 = card_v2(card, raw=raw, extra=extra)
        png = await asyncio.to_thread(cover_png, cover.data if cover else None)
        data = embed_card(png, v2=v2, v3=v3)
        log.info("card.exported", card_id=card_id, format=fmt, bytes=len(data))
        return ExportedCard(data, "image/png", _filename(row.name, "png"))

    async def blob(self, user_id: str, blob_id: str) -> BlobView:
        if not is_uuid(blob_id):
            raise NotFound("File not found")
        async with self._engine.connect() as conn:
            row = await library_repo.get_blob(conn, user_id, blob_id)
        if row is None:
            raise NotFound("File not found")
        return BlobView(mime=row.mime, data=row.data, sha256=row.sha256)
