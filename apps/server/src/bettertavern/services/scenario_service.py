"""剧本仓库：从角色卡仓库里选一张或几张卡建剧本（群像剧本），挂几本世界书，改名字、设置、换卡、
换世界书，删除。

剧本实时引用角色卡和世界书：只记 id，开新故事时读它们当时最新的内容；已经开始的故事不受影响。
剧本的设置（默认人设、偏好、用哪条开场白）开新故事时预填。改名字、设置、换卡、换世界书
都让版本号加 1。选了默认人设时，设置里的 protagonist 写成那个人设的副本（给旧版 App 读）。
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.scenario.lorebook import MAX_LOREBOOKS_PER_SCENARIO
from bettertavern.domain.scenario.setup import (
    MAX_SCENARIO_CARDS,
    ScenarioSetup,
    opening_problem,
)
from bettertavern.infra.db.repositories import cards as cards_repo
from bettertavern.infra.db.repositories import library as repo
from bettertavern.infra.db.repositories import lorebooks as lorebooks_repo
from bettertavern.infra.db.repositories import personas as personas_repo
from bettertavern.infra.db.sqlutil import is_uuid

from .card_service import preview, strip_nul
from .errors import Conflict, Invalid, NotFound

log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class ScenarioCardView:
    card_id: str
    name: str
    cover_blob_id: str | None


@dataclass(frozen=True, slots=True)
class ScenarioLorebookView:
    lorebook_id: str
    name: str
    entries: int


@dataclass(frozen=True, slots=True)
class ScenarioView:
    id: str
    name: str
    cards: list[ScenarioCardView]
    cover_blob_id: str | None  # 主角色卡（第 0 张）的封面
    setup: dict[str, Any]
    description_preview: str
    version: int
    created_at: datetime
    updated_at: datetime
    lorebooks: list[ScenarioLorebookView]


@dataclass(frozen=True, slots=True)
class ScenarioPatch:
    name: str | None = None
    setup: dict[str, Any] | None = None
    card_ids: list[str] | None = None
    lorebook_ids: list[str] | None = None
    version: int | None = None


def _view(row: repo.ScenarioRow, *, lead: CharacterCard | None = None) -> ScenarioView:
    cards = [ScenarioCardView(r.card_id, r.name, r.cover_blob_id) for r in row.cards]
    return ScenarioView(
        id=row.id,
        name=row.name,
        cards=cards,
        cover_blob_id=cards[0].cover_blob_id if cards else None,
        setup=ScenarioSetup.from_json(row.setup).to_json(),
        description_preview=(
            preview(lead.description, char=lead.name or row.name) if lead is not None else ""
        ),
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        lorebooks=[ScenarioLorebookView(b.lorebook_id, b.name, b.entries) for b in row.lorebooks],
    )


def _name(value: str) -> str:
    name = strip_nul(value).strip()[:80]
    if not name:
        raise Invalid("The name can't be empty", field="name")
    return name


def _card_ids(values: list[str]) -> list[str]:
    ids = list(dict.fromkeys(v for v in values if v))
    if not ids:
        raise Invalid("Choose at least one character card", field="card_ids")
    if len(ids) > MAX_SCENARIO_CARDS:
        raise Invalid(f"A scenario can use at most {MAX_SCENARIO_CARDS} cards", field="card_ids")
    if not all(is_uuid(i) for i in ids):
        raise NotFound("Character card not found")
    return ids


def _lorebook_ids(values: list[str]) -> list[str]:
    ids = list(dict.fromkeys(v for v in values if v))
    if len(ids) > MAX_LOREBOOKS_PER_SCENARIO:
        raise Invalid(
            f"A scenario can use at most {MAX_LOREBOOKS_PER_SCENARIO} lorebooks",
            field="lorebook_ids",
        )
    if not all(is_uuid(i) for i in ids):
        raise NotFound("Lorebook not found")
    return ids


async def _check_lorebooks(conn: Any, user_id: str, ids: list[str]) -> None:
    if len(await lorebooks_repo.owned_ids(conn, user_id, ids)) != len(ids):
        raise NotFound("Lorebook not found")


class ScenarioService:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def list(self, user_id: str) -> list[ScenarioView]:
        async with self._engine.connect() as conn:
            rows = await repo.list_scenarios(conn, user_id)
            leads = await cards_repo.get_cards(
                conn, user_id, [r.cards[0].card_id for r in rows if r.cards]
            )
        by_id = {c.id: CharacterCard.model_validate(c.card) for c in leads}
        return [_view(r, lead=by_id.get(r.cards[0].card_id) if r.cards else None) for r in rows]

    async def get(self, user_id: str, scenario_id: str) -> ScenarioView:
        if not is_uuid(scenario_id):
            raise NotFound("Scenario not found")
        async with self._engine.connect() as conn:
            row = await repo.get_scenario(conn, user_id, scenario_id)
            if row is None:
                raise NotFound("Scenario not found")
            leads = await cards_repo.get_cards(conn, user_id, [c.card_id for c in row.cards[:1]])
        lead = CharacterCard.model_validate(leads[0].card) if leads else None
        return _view(row, lead=lead)

    async def _checked(
        self, conn: Any, user_id: str, card_ids: list[str], setup: dict[str, Any]
    ) -> tuple[list[cards_repo.CardRow], dict[str, Any]]:
        rows = await cards_repo.get_cards(conn, user_id, card_ids)
        if len(rows) != len(card_ids):
            raise NotFound("Character card not found")
        parsed = ScenarioSetup.from_json(setup)
        problem = opening_problem(
            parsed.opening, [(r.id, CharacterCard.model_validate(r.card)) for r in rows]
        )
        if problem is not None:
            raise Invalid(problem, field="setup.opening")
        if parsed.persona_id is not None:
            persona = (
                await personas_repo.get_persona(conn, user_id, parsed.persona_id)
                if is_uuid(parsed.persona_id)
                else None
            )
            if persona is None:
                raise Invalid("That persona doesn't exist", field="setup.persona_id")
            parsed = replace(
                parsed,
                protagonist_name=persona.name,
                protagonist_summary=persona.description[: personas_repo.MIRROR_SUMMARY_CHARS],
            )
        return rows, parsed.to_json()

    async def create(
        self,
        user_id: str,
        *,
        name: str | None,
        card_ids: list[str],
        setup: dict[str, Any],
        lorebook_ids: list[str] | None = None,
    ) -> ScenarioView:
        ids = _card_ids(card_ids)
        books = _lorebook_ids(lorebook_ids or [])
        async with self._engine.begin() as conn:
            rows, clean = await self._checked(conn, user_id, ids, setup)
            await _check_lorebooks(conn, user_id, books)
            row = await repo.insert_scenario(
                conn,
                user_id=user_id,
                name=_name(name) if name else rows[0].name,
                setup=clean,
                card_ids=ids,
                lorebook_ids=books,
            )
        log.info("scenario.created", scenario_id=row.id, cards=len(ids), lorebooks=len(books))
        return _view(row, lead=CharacterCard.model_validate(rows[0].card))

    async def update(self, user_id: str, scenario_id: str, patch: ScenarioPatch) -> ScenarioView:
        if not is_uuid(scenario_id):
            raise NotFound("Scenario not found")
        async with self._engine.begin() as conn:
            row = await repo.get_scenario(conn, user_id, scenario_id, lock=True)
            if row is None:
                raise NotFound("Scenario not found")
            if patch.version is not None and patch.version != row.version:
                raise Conflict(
                    "This scenario was changed somewhere else; reload it before editing",
                    code="SCENARIO_CHANGED",
                    version=row.version,
                )
            ids = (
                _card_ids(patch.card_ids)
                if patch.card_ids is not None
                else [c.card_id for c in row.cards]
            )
            setup = patch.setup if patch.setup is not None else row.setup
            rows, clean = await self._checked(conn, user_id, ids, setup)
            books = _lorebook_ids(patch.lorebook_ids) if patch.lorebook_ids is not None else None
            if books is not None:
                await _check_lorebooks(conn, user_id, books)
            updated = await repo.update_scenario(
                conn,
                user_id,
                scenario_id,
                name=_name(patch.name) if patch.name is not None else row.name,
                setup=clean,
                card_ids=ids if patch.card_ids is not None else None,
                expected_version=row.version,
                lorebook_ids=books,
            )
            assert updated is not None  # 已经锁住了这一行
        log.info(
            "scenario.updated",
            scenario_id=scenario_id,
            version=updated.version,
            cards_changed=patch.card_ids is not None,
            lorebooks_changed=patch.lorebook_ids is not None,
        )
        return _view(updated, lead=CharacterCard.model_validate(rows[0].card))

    async def delete(self, user_id: str, scenario_id: str) -> None:
        if not is_uuid(scenario_id):
            raise NotFound("Scenario not found")
        async with self._engine.begin() as conn:
            if not await repo.delete_scenario(conn, user_id, scenario_id):
                raise NotFound("Scenario not found")
        log.info("scenario.deleted", scenario_id=scenario_id)
