"""工作台的草稿：新建（手动、导入文件、打开仓库里的卡）、自动保存、切模式、封面和图片、保存到角色卡仓库、删除。

- 草稿不在角色卡仓库里，点“保存”才正式进库；改仓库里已有的卡也是先开一份草稿。
- 自动保存带草稿的版本号，对不上返回 409 DRAFT_CHANGED，客户端重读（agent 同时在写时就会这样）。
- 保存回已有的卡带着开草稿时卡的版本号，对不上返回 409 CARD_CHANGED，让用户选覆盖还是另存成新卡。
- 保存前用和客户端同一套规则检查（domain/scenario/check.py），有 error 就返回 422 和问题清单。

agent 模式（对话、问卷、方案、动手）在 workbench_service.py。卡片文字不进日志。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import structlog
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.scenario.check import Issue, blocking, check_card
from bettertavern.domain.scenario.edit import CardEdit, EditError, apply_edit, book_in_order
from bettertavern.domain.story.language import DEFAULT_LANGUAGE, parse_language
from bettertavern.importers.character_card import CardError, import_card
from bettertavern.importers.images import ImageError, clean_image
from bettertavern.infra.db.repositories import cards as cards_repo
from bettertavern.infra.db.repositories import drafts as repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import web as web_repo
from bettertavern.infra.db.repositories import workbench as workbench_repo
from bettertavern.infra.db.sqlutil import is_uuid

from .card_service import CardSummary, strip_nul, summary_of
from .errors import AppError, Conflict, Invalid, NotFound
from .scenario_service import ScenarioService, ScenarioView

log = structlog.get_logger(__name__)

Origin = Literal["agent", "manual", "import_file", "edit_card"]
Mode = Literal["agent", "manual"]
ConflictChoice = Literal["overwrite", "copy"]

# 封面只能用这几种版权的图；copyrighted、unknown 要先确认“仅限个人使用”
FREE_LICENSES = ("public_domain", "own")


def empty_card() -> CharacterCard:
    return CharacterCard(spec="card_v3", name="")


@dataclass(frozen=True, slots=True)
class AssetView:
    id: str
    blob_id: str
    source: str
    license: str
    source_url: str | None
    prompt: str | None
    mime: str
    width: int | None
    height: int | None
    personal_use: bool
    created_at: datetime


@dataclass(frozen=True, slots=True)
class NoteView:
    id: str
    text: str
    url: str
    title: str
    site: str
    used_in: list[str]


@dataclass(frozen=True, slots=True)
class DraftSummary:
    id: str
    name: str
    character_name: str
    origin: str
    card_id: str | None
    cover_blob_id: str | None
    mode: str
    stage: str
    agent_status: str
    awaiting: dict[str, Any] | None
    version: int
    saved_version: int | None
    unsaved: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class DraftView:
    summary: DraftSummary
    card: CharacterCard  # 世界书按 order 排好
    cover_asset_id: str | None
    base_version: int | None
    todos: list[dict[str, Any]]
    language: str
    issues: list[Issue]
    assets: list[AssetView] = field(default_factory=list)
    notes: list[NoteView] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ImportResult:
    draft: DraftView | None
    existing_card: CardSummary | None  # 这个文件已经导入过：先问用户打开它还是另起一份


@dataclass(frozen=True, slots=True)
class SaveResult:
    card: CardSummary
    draft: DraftView
    scenario: ScenarioView | None


def asset_view(row: repo.AssetRow) -> AssetView:
    return AssetView(
        id=row.id,
        blob_id=row.blob_id,
        source=row.source,
        license=row.license,
        source_url=row.source_url,
        prompt=row.prompt,
        mime=row.mime,
        width=row.width,
        height=row.height,
        personal_use=bool(row.meta.get("personal_use")),
        created_at=row.created_at,
    )


def card_of(row: repo.DraftRow) -> CharacterCard:
    return CharacterCard.model_validate(row.card)


def summary_of_draft(row: repo.DraftRow) -> DraftSummary:
    card = card_of(row)
    return DraftSummary(
        id=row.id,
        name=row.name,
        character_name=card.name,
        origin=row.origin,
        card_id=row.card_id,
        cover_blob_id=row.cover_blob_id,
        mode=row.mode,
        stage=row.stage,
        agent_status=row.agent_status,
        awaiting=row.awaiting,
        version=row.version,
        saved_version=row.saved_version,
        unsaved=row.unsaved,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def note_view(row: web_repo.NoteRow) -> NoteView:
    return NoteView(
        id=row.id,
        text=row.text,
        url=str(row.source.get("url") or ""),
        title=str(row.source.get("title") or ""),
        site=str(row.source.get("site") or ""),
        used_in=row.used_in,
    )


def draft_view(
    row: repo.DraftRow,
    assets: list[repo.AssetRow] | None = None,
    notes: list[web_repo.NoteRow] | None = None,
) -> DraftView:
    card = card_of(row)
    return DraftView(
        summary=summary_of_draft(row),
        card=card.model_copy(update={"book": book_in_order(card.book)}),
        cover_asset_id=row.cover_asset_id,
        base_version=row.base_version,
        todos=row.todos,
        language=row.language,
        issues=check_card(card, display_name=row.name or card.name),
        assets=[asset_view(a) for a in assets or []],
        notes=[note_view(n) for n in notes or []],
    )


def _display_name(value: str) -> str:
    return strip_nul(value).strip()[:80]


def issues_extra(issues: list[Issue]) -> list[dict[str, Any]]:
    return [
        {"field": i.field, "code": i.code, "level": i.level, "params": i.params} for i in issues
    ]


class DraftService:
    def __init__(self, engine: AsyncEngine, scenarios: ScenarioService) -> None:
        self._engine = engine
        self._scenarios = scenarios

    # ---- 读 ----

    async def _row(
        self, conn: AsyncConnection, user_id: str, draft_id: str, *, lock: bool = False
    ) -> repo.DraftRow:
        if not is_uuid(draft_id):
            raise NotFound("Draft not found")
        row = await repo.get_draft(conn, user_id, draft_id, lock=lock)
        if row is None:
            raise NotFound("Draft not found")
        return row

    async def list(self, user_id: str) -> list[DraftSummary]:
        async with self._engine.connect() as conn:
            rows = await repo.list_unsaved_drafts(conn, user_id)
        return [summary_of_draft(r) for r in rows]

    async def get(self, user_id: str, draft_id: str) -> DraftView:
        async with self._engine.connect() as conn:
            row = await self._row(conn, user_id, draft_id)
            assets = await repo.list_assets(conn, row.id)
            notes = await web_repo.list_notes(conn, row.id)
        return draft_view(row, assets, notes)

    # ---- 新建 ----

    async def create_manual(self, user_id: str, *, language: str) -> DraftView:
        async with self._engine.begin() as conn:
            row = await repo.insert_draft(
                conn,
                user_id=user_id,
                origin="manual",
                name="",
                card=empty_card().model_dump(mode="json"),
                mode="manual",
                language=parse_language(language),
            )
        log.info("draft.created", draft_id=row.id, origin="manual")
        return draft_view(row)

    async def open_card(self, user_id: str, card_id: str, *, language: str) -> DraftView:
        """从仓库打开一张卡：这张卡已经有草稿就打开它，没有就复制卡的内容新建一份。"""
        if not is_uuid(card_id):
            raise NotFound("Character card not found")
        async with self._engine.begin() as conn:
            card = await cards_repo.get_card(conn, user_id, card_id, lock=True)
            if card is None:
                raise NotFound("Character card not found")
            existing = await repo.find_draft_for_card(conn, user_id, card_id)
            if existing is not None:
                if not existing.unsaved and existing.base_version != card.version:
                    # 草稿保存过、之后卡在别处又改过（恢复了旧版之类）：
                    # 草稿已经旧了，换成卡现在的内容
                    await self._refresh_from_card(conn, existing, card)
                    existing = await repo.get_draft(conn, user_id, existing.id)
                    assert existing is not None
                assets = await repo.list_assets(conn, existing.id)
                return draft_view(existing, assets)
            row = await repo.insert_draft(
                conn,
                user_id=user_id,
                origin="edit_card",
                name=card.name,
                card=card.card,
                card_id=card.id,
                base_version=card.version,
                mode="agent",
                stage="revise",
                language=parse_language(language),
            )
            if card.cover_blob_id is not None:
                asset = await repo.insert_asset(
                    conn,
                    user_id=user_id,
                    draft_id=row.id,
                    blob_id=card.cover_blob_id,
                    source="card",
                    license="own",
                )
                row = await repo.set_cover(conn, user_id, row.id, asset.id)
                assert row is not None
            await repo.mark_saved(
                conn, row.id, card_id=card.id, base_version=card.version, saved_version=row.version
            )
            row = await repo.get_draft(conn, user_id, row.id)
            assert row is not None
            assets = await repo.list_assets(conn, row.id)
        log.info("draft.created", draft_id=row.id, origin="edit_card")
        return draft_view(row, assets)

    async def _refresh_from_card(
        self, conn: AsyncConnection, draft: repo.DraftRow, card: cards_repo.CardRow
    ) -> None:
        updated = await repo.update_content(
            conn,
            draft.user_id,
            draft.id,
            expected_version=draft.version,
            name=card.name,
            card=card.card,
        )
        assert updated is not None
        asset_id: str | None = None
        if card.cover_blob_id is not None:
            asset = await repo.find_asset_by_blob(conn, draft.id, card.cover_blob_id)
            if asset is None:
                asset = await repo.insert_asset(
                    conn,
                    user_id=draft.user_id,
                    draft_id=draft.id,
                    blob_id=card.cover_blob_id,
                    source="card",
                    license="own",
                )
            asset_id = asset.id
        covered = await repo.set_cover(conn, draft.user_id, draft.id, asset_id)
        assert covered is not None
        await repo.mark_saved(
            conn,
            draft.id,
            card_id=card.id,
            base_version=card.version,
            saved_version=covered.version,
        )

    async def import_file(
        self, user_id: str, data: bytes, *, language: str, allow_duplicate: bool
    ) -> ImportResult:
        """导入一张卡：解析成草稿（进手动表单）。同一个文件已经导入过时，默认不建草稿，返回已有的卡。"""
        started = time.perf_counter()
        try:
            # 解析（哈希、base64、JSON、PNG 解压）放到线程里，不占用事件循环
            imported = await asyncio.to_thread(import_card, data)
        except CardError as exc:
            log.info("draft.import_failed", bytes=len(data), reason=str(exc))
            raise Invalid(
                f"Couldn't import the character card: {exc}", code="CARD_INVALID"
            ) from exc
        image = None
        if imported.image is not None:
            try:
                image = await asyncio.to_thread(clean_image, imported.image)
            except ImageError:
                image = None  # 卡片数据没问题、图坏了：照样导入，只是没有封面
        async with self._engine.begin() as conn:
            existing = await cards_repo.find_card_by_sha(conn, user_id, imported.sha256)
            if existing is not None and not allow_duplicate:
                log.info("draft.imported", duplicate=True, card_id=existing.id)
                return ImportResult(draft=None, existing_card=summary_of(existing))
            row = await repo.insert_draft(
                conn,
                user_id=user_id,
                origin="import_file",
                name=strip_nul(imported.card.name),
                card=strip_nul(imported.card.model_dump(mode="json")),
                raw=strip_nul(imported.raw),
                source_sha256=imported.sha256,
                mode="manual",
                stage="revise",
                language=parse_language(language or DEFAULT_LANGUAGE),
            )
            if image is not None:
                blob_id = await library_repo.insert_blob(
                    conn,
                    user_id=user_id,
                    sha256=image.sha256,
                    mime=image.mime,
                    data=image.data,
                    width=image.width,
                    height=image.height,
                )
                asset = await repo.insert_asset(
                    conn,
                    user_id=user_id,
                    draft_id=row.id,
                    blob_id=blob_id,
                    source="card",
                    license="own",
                )
                covered = await repo.set_cover(conn, user_id, row.id, asset.id)
                assert covered is not None
                row = covered
            assets = await repo.list_assets(conn, row.id)
        log.info(
            "draft.imported",
            draft_id=row.id,
            duplicate=existing is not None,
            bytes=len(data),
            spec=imported.card.spec,
            has_image=image is not None,
            book_entries=len(imported.card.book),
            truncated_fields=list(imported.card.truncated),
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
        return ImportResult(draft=draft_view(row, assets), existing_card=None)

    # ---- 改 ----

    async def update_card(
        self, user_id: str, draft_id: str, *, version: int, name: str, edit: CardEdit
    ) -> DraftView:
        """手动模式的自动保存：宽松模式（名字、条目内容可以暂时是空的），长度照样检查。"""
        async with self._engine.begin() as conn:
            row = await self._row(conn, user_id, draft_id)
            if row.version != version:
                raise Conflict(
                    "This draft was changed somewhere else; reload it",
                    code="DRAFT_CHANGED",
                    version=row.version,
                )
            try:
                card = apply_edit(card_of(row), edit, lenient=True)
            except EditError as exc:
                raise Invalid(exc.message, field=exc.field) from exc
            updated = await repo.update_content(
                conn,
                user_id,
                draft_id,
                expected_version=version,
                name=_display_name(name),
                card=card.model_dump(mode="json"),
            )
            if updated is None:  # 读完之后、写之前被 agent 改了
                raise Conflict(
                    "This draft was changed somewhere else; reload it",
                    code="DRAFT_CHANGED",
                    version=version + 1,
                )
            assets = await repo.list_assets(conn, draft_id)
        return draft_view(updated, assets)

    async def set_mode(self, user_id: str, draft_id: str, mode: Mode) -> DraftView:
        async with self._engine.begin() as conn:
            await self._row(conn, user_id, draft_id)
            row = await repo.set_mode(conn, user_id, draft_id, mode)
            assert row is not None
            assets = await repo.list_assets(conn, draft_id)
        return draft_view(row, assets)

    # ---- 图片 ----

    async def upload_asset(self, user_id: str, draft_id: str, data: bytes) -> AssetView:
        try:
            image = await asyncio.to_thread(clean_image, data)
        except ImageError as exc:
            raise Invalid(str(exc), code="IMAGE_INVALID", field="file") from exc
        async with self._engine.begin() as conn:
            await self._row(conn, user_id, draft_id)
            blob_id = await library_repo.insert_blob(
                conn,
                user_id=user_id,
                sha256=image.sha256,
                mime=image.mime,
                data=image.data,
                width=image.width,
                height=image.height,
            )
            asset = await repo.insert_asset(
                conn,
                user_id=user_id,
                draft_id=draft_id,
                blob_id=blob_id,
                source="upload",
                license="own",
            )
        log.info(
            "draft.asset_uploaded", draft_id=draft_id, asset_id=asset.id, bytes=len(image.data)
        )
        return asset_view(asset)

    async def set_cover(
        self, user_id: str, draft_id: str, asset_id: str | None, *, personal_use: bool
    ) -> DraftView:
        async with self._engine.begin() as conn:
            row = await self._row(conn, user_id, draft_id, lock=True)
            if asset_id is not None:
                if not is_uuid(asset_id):
                    raise NotFound("Image not found")
                asset = await repo.get_asset(conn, user_id, asset_id)
                if asset is None or asset.draft_id != row.id:
                    raise NotFound("Image not found")
                if asset.license not in FREE_LICENSES and not asset.meta.get("personal_use"):
                    if not personal_use:
                        raise AppError(
                            "This image may be copyrighted; confirm it's for personal use only",
                            code="IMAGE_LICENSE",
                            status=409,
                            license=asset.license,
                        )
                    await repo.update_asset_meta(
                        conn, asset.id, {**asset.meta, "personal_use": True}
                    )
            updated = await repo.set_cover(conn, user_id, draft_id, asset_id)
            assert updated is not None
            assets = await repo.list_assets(conn, draft_id)
        return draft_view(updated, assets)

    # ---- 保存到仓库 ----

    async def save(
        self,
        user_id: str,
        draft_id: str,
        *,
        new_scenario: bool = False,
        on_conflict: ConflictChoice | None = None,
    ) -> SaveResult:
        async with self._engine.begin() as conn:
            row = await self._row(conn, user_id, draft_id, lock=True)
            display_name = row.name or card_of(row).name
            try:
                card = apply_edit(card_of(row), CardEdit.of(card_of(row)))
            except EditError as exc:
                card = card_of(row)
                issues = check_card(card, display_name=display_name) or [
                    Issue(exc.field, "invalid", "error")
                ]
                raise Invalid(
                    exc.message,
                    code="CARD_CHECK_FAILED",
                    field=exc.field,
                    issues=issues_extra(issues),
                ) from exc
            issues = blocking(check_card(card, display_name=display_name))
            if issues:
                raise Invalid(
                    "The character card isn't ready to save",
                    code="CARD_CHECK_FAILED",
                    field=issues[0].field,
                    issues=issues_extra(issues),
                )
            cover_blob_id = row.cover_blob_id
            research = await _research_meta(conn, row)
            card = _with_sources(card, research.get("sources") or [], row.language)
            card_json = strip_nul(card.model_dump(mode="json"))
            if row.origin == "agent":
                made_by = "agent"
            else:  # 手动开始、导入、从仓库打开的：agent 接手写过就算两者都有
                made_by = "mixed" if row.last_seq > 0 else "manual"
            target = (
                await cards_repo.get_card(conn, user_id, row.card_id, lock=True)
                if row.card_id is not None
                else None
            )
            if target is not None and on_conflict != "copy":
                if target.version != row.base_version and on_conflict != "overwrite":
                    raise Conflict(
                        "This character card was changed somewhere else since the draft was opened",
                        code="CARD_CHANGED",
                        version=target.version,
                    )
                meta = {
                    **target.meta,
                    **research,
                    "made_by": _merge_made_by(target.meta, made_by),
                }
                saved = await cards_repo.update_card(
                    conn,
                    user_id,
                    target.id,
                    name=display_name,
                    card=card_json,
                    cover_blob_id=cover_blob_id,
                    meta=meta,
                    expected_version=target.version,
                )
                assert saved is not None  # 已经锁住了这一行
                created = False
            else:
                sha = row.source_sha256
                if sha is not None and await cards_repo.find_card_by_sha(conn, user_id, sha):
                    sha = None  # 同一个文件已经有一张卡了：另存的这张不再记文件指纹
                raw = await repo.get_draft_raw(conn, row.id)
                saved = await cards_repo.insert_card(
                    conn,
                    user_id=user_id,
                    name=display_name,
                    source=_source(row.origin, card),
                    source_sha256=sha,
                    raw=raw,
                    card=card_json,
                    cover_blob_id=cover_blob_id,
                    meta={**research, "made_by": made_by},
                )
                created = True
            dropped = await cards_repo.insert_revision(conn, card=saved, draft_id=row.id, note="")
            await library_repo.delete_orphan_blobs(conn, user_id, dropped)
            await repo.mark_saved(
                conn,
                row.id,
                card_id=saved.id,
                base_version=saved.version,
                saved_version=row.version,
            )
            draft = await repo.get_draft(conn, user_id, row.id)
            assert draft is not None
            assets = await repo.list_assets(conn, row.id)
        log.info(
            "draft.saved",
            draft_id=draft_id,
            card_id=saved.id,
            created=created,
            version=saved.version,
            on_conflict=on_conflict,
            book_entries=len(card.book),
            total_chars=card.total_chars(),
        )
        scenario = None
        if new_scenario:
            scenario = await self._scenarios.create(
                user_id, name=None, card_ids=[saved.id], setup={}
            )
        async with self._engine.connect() as conn:
            fresh = await cards_repo.get_card(conn, user_id, saved.id)
        assert fresh is not None
        return SaveResult(
            card=summary_of(fresh), draft=draft_view(draft, assets), scenario=scenario
        )

    async def delete(self, user_id: str, draft_id: str) -> None:
        if not is_uuid(draft_id):
            raise NotFound("Draft not found")
        async with self._engine.begin() as conn:
            blobs = await repo.delete_draft(conn, user_id, draft_id)
            if blobs is None:
                raise NotFound("Draft not found")
            await library_repo.delete_orphan_blobs(conn, user_id, blobs)
        log.info("draft.deleted", draft_id=draft_id)


def _source(origin: str, card: CharacterCard) -> str:
    if origin == "import_file":
        return card.spec
    return "agent" if origin == "agent" else "manual"


def _merge_made_by(meta: dict[str, Any], now: str) -> str:
    before = meta.get("made_by")
    if before in (None, now):
        return now
    return "mixed"


# 资料来源写进作者备注时的标题（卡片内容，按草稿的语言）
SOURCES_LABEL = {"zh": "资料来源：", "en": "Sources:", "ja": "出典："}


async def _research_meta(conn: AsyncConnection, row: repo.DraftRow) -> dict[str, Any]:
    """agent 查过的资料（笔记的出处）和确认的方案里写的作品信息 → cards.meta 的 sources、ip。"""
    meta: dict[str, Any] = {}
    sources: dict[str, dict[str, Any]] = {}
    for note in await web_repo.list_notes(conn, row.id):
        url = str(note.source.get("url") or "")
        if not url:
            continue
        entry = sources.setdefault(
            url, {"url": url, "title": str(note.source.get("title") or ""), "used_in": []}
        )
        for where in note.used_in:
            if where not in entry["used_in"]:
                entry["used_in"].append(where)
    if sources:
        meta["sources"] = list(sources.values())[:30]
    if row.plan_approved_seq is not None:
        plan = await workbench_repo.get_message(conn, row.id, row.plan_approved_seq)
        ip = plan.content.get("ip") if plan is not None else None
        if isinstance(ip, dict) and ip.get("work"):
            meta["ip"] = {
                "work": str(ip.get("work") or "")[:80],
                "character": str(ip.get("character") or "")[:80],
            }
    return meta


def _with_sources(
    card: CharacterCard, sources: list[dict[str, Any]], language: str
) -> CharacterCard:
    """作者备注里还没写到的资料来源补在最后。"""
    missing = [s for s in sources if s["url"] not in card.creator_notes]
    if not missing:
        return card
    lines = [f"- {s['title']} {s['url']}".replace("-  ", "- ") for s in missing]
    label = SOURCES_LABEL.get(language, SOURCES_LABEL["en"])
    notes = (
        f"{card.creator_notes.rstrip()}\n\n{label}\n"
        if card.creator_notes.strip()
        else f"{label}\n"
    )
    return card.model_copy(update={"creator_notes": (notes + "\n".join(lines))[:60_000]})
