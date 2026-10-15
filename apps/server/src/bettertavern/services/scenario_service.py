"""剧本库：导入角色卡（PNG 或 JSON），列表、详情、改名、删除，头像读取。"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.importers.character_card import CardError, import_card
from bettertavern.infra.db.repositories import library as repo
from bettertavern.infra.db.sqlutil import is_uuid

from .errors import Invalid, NotFound

# 角色卡的文字不进日志，只记大小、格式、条目数和被截断的字段名
log = structlog.get_logger(__name__)

PREVIEW_CHARS = 280


@dataclass(frozen=True, slots=True)
class ScenarioView:
    id: str
    name: str
    source_kind: str
    avatar_blob_id: str | None
    description_preview: str
    first_mes_preview: str
    creator: str
    tags: list[str]
    book_entries: int
    alternate_greetings: int
    truncated_fields: list[str]
    created_at: datetime
    updated_at: datetime
    duplicate: bool = False  # 导入时发现同一个文件已经导入过


@dataclass(frozen=True, slots=True)
class BlobView:
    mime: str
    data: bytes
    sha256: str


def strip_nul(value: Any) -> Any:
    """Postgres 的 JSONB 和 TEXT 不接受 \\u0000：递归去掉。"""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [strip_nul(v) for v in value]
    if isinstance(value, dict):
        return {strip_nul(str(k)): strip_nul(v) for k, v in value.items()}
    return value


def _preview(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= PREVIEW_CHARS else text[:PREVIEW_CHARS] + "…"


def card_of(row: repo.ScenarioRow) -> CharacterCard:
    return CharacterCard.model_validate(row.card)


def _view(row: repo.ScenarioRow, *, duplicate: bool = False) -> ScenarioView:
    card = card_of(row)
    return ScenarioView(
        id=row.id,
        name=row.name,
        source_kind=row.source_kind,
        avatar_blob_id=row.avatar_blob_id,
        description_preview=_preview(card.description),
        first_mes_preview=_preview(card.first_mes),
        creator=card.creator,
        tags=list(card.tags),
        book_entries=len(card.book),
        alternate_greetings=len(card.alternate_greetings),
        truncated_fields=list(card.truncated),
        created_at=row.created_at,
        updated_at=row.updated_at,
        duplicate=duplicate,
    )


class ScenarioService:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def import_file(self, user_id: str, data: bytes) -> ScenarioView:
        started = time.perf_counter()
        try:
            # 解析（哈希、base64、JSON、PNG 解压）放到线程里，不占用事件循环
            imported = await asyncio.to_thread(import_card, data)
        except CardError as exc:
            log.info(
                "scenario.import_failed",
                bytes=len(data),
                reason=str(exc),
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
            raise Invalid(f"角色卡导入失败：{exc}", code="CARD_INVALID") from exc
        card_info = {
            "bytes": len(data),
            "spec": imported.card.spec,
            "has_image": imported.image is not None,
            "book_entries": len(imported.card.book),
            "greetings": 1 + len(imported.card.alternate_greetings),
            "truncated_fields": list(imported.card.truncated),
        }
        async with self._engine.begin() as conn:
            existing = await repo.find_scenario_by_sha(conn, user_id, imported.sha256)
            if existing is not None:
                log.info(
                    "scenario.imported",
                    scenario_id=existing.id,
                    duplicate=True,
                    duration_ms=round((time.perf_counter() - started) * 1000),
                    **card_info,
                )
                return _view(existing, duplicate=True)
            blob_id = None
            if imported.image is not None and imported.image_mime is not None:
                blob_id = await repo.insert_blob(
                    conn,
                    user_id=user_id,
                    sha256=imported.sha256,
                    mime=imported.image_mime,
                    data=imported.image,
                )
            card = strip_nul(imported.card.model_dump(mode="json"))
            row = await repo.insert_scenario(
                conn,
                user_id=user_id,
                name=strip_nul(imported.card.name),
                source_kind=imported.card.spec,
                source_sha256=imported.sha256,
                raw=strip_nul(imported.raw),
                card=card,
                avatar_blob_id=blob_id,
            )
        log.info(
            "scenario.imported",
            scenario_id=row.id,
            duplicate=False,
            duration_ms=round((time.perf_counter() - started) * 1000),
            **card_info,
        )
        return _view(row)

    async def list(self, user_id: str) -> list[ScenarioView]:
        async with self._engine.connect() as conn:
            rows = await repo.list_scenarios(conn, user_id)
        return [_view(r) for r in rows]

    async def row(self, user_id: str, scenario_id: str) -> repo.ScenarioRow:
        if not is_uuid(scenario_id):
            raise NotFound("剧本不存在")
        async with self._engine.connect() as conn:
            row = await repo.get_scenario(conn, user_id, scenario_id)
        if row is None:
            raise NotFound("剧本不存在")
        return row

    async def get(self, user_id: str, scenario_id: str) -> ScenarioView:
        return _view(await self.row(user_id, scenario_id))

    async def card(self, user_id: str, scenario_id: str) -> CharacterCard:
        return card_of(await self.row(user_id, scenario_id))

    async def rename(self, user_id: str, scenario_id: str, name: str) -> ScenarioView:
        name = strip_nul(name).strip()[:80]
        if not name:
            raise Invalid("名字不能为空", field="name")
        if not is_uuid(scenario_id):
            raise NotFound("剧本不存在")
        async with self._engine.begin() as conn:
            row = await repo.rename_scenario(conn, user_id, scenario_id, name)
        if row is None:
            raise NotFound("剧本不存在")
        return _view(row)

    async def delete(self, user_id: str, scenario_id: str) -> None:
        if not is_uuid(scenario_id):
            raise NotFound("剧本不存在")
        async with self._engine.begin() as conn:
            blob = await repo.delete_scenario(conn, user_id, scenario_id)
            if blob is None:
                raise NotFound("剧本不存在")
            if blob:
                await repo.delete_blob(conn, user_id, blob)
        log.info("scenario.deleted", scenario_id=scenario_id)

    async def blob(self, user_id: str, blob_id: str) -> BlobView:
        if not is_uuid(blob_id):
            raise NotFound("文件不存在")
        async with self._engine.connect() as conn:
            row = await repo.get_blob(conn, user_id, blob_id)
        if row is None:
            raise NotFound("文件不存在")
        return BlobView(mime=row.mime, data=row.data, sha256=row.sha256)
