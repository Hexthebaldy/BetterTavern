"""游玩：开局（WorldBuilder 与开场回合在后台进行）、列表、详情、改名、删除，世界状态的只读视图。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.language import DEFAULT_LANGUAGE, parse_language
from bettertavern.domain.world.names import clean_display_name
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import story as repo
from bettertavern.infra.db.sqlutil import as_str, is_uuid
from bettertavern.runtime.ports import Preferences
from bettertavern.runtime.runner import TurnRunnerPool

from .errors import AppError, Invalid, NotFound
from .route_service import RouteService
from .turn_service import header_for
from .turn_store import load_world
from .views import PlaythroughDetail, PlaythroughView, TurnView


@dataclass(frozen=True, slots=True)
class NewPlaythrough:
    scenario_id: str
    protagonist_name: str
    protagonist_summary: str = ""
    title: str | None = None
    preferences: dict[str, Any] | None = None
    language: str = DEFAULT_LANGUAGE


@dataclass(frozen=True, slots=True)
class WorldEntityView:
    id: str
    kind: str
    name: str
    aliases: list[str]
    summary: str
    data: dict[str, Any]
    importance: int
    is_protagonist: bool


@dataclass(frozen=True, slots=True)
class WorldFactView:
    id: str
    text: str
    entity_ids: list[str]
    importance: int
    secret: bool


@dataclass(frozen=True, slots=True)
class WorldView:
    entities: list[WorldEntityView]
    links: list[dict[str, str]]
    facts: list[WorldFactView]
    hidden_facts: int


class PlaythroughService:
    def __init__(
        self,
        engine: AsyncEngine,
        routes: RouteService,
        runners: TurnRunnerPool,
        *,
        lease_ttl_s: float,
        instance_id: str,
    ) -> None:
        self._engine = engine
        self._routes = routes
        self._runners = runners
        self._lease_ttl = lease_ttl_s
        self._instance = instance_id

    async def create(self, user_id: str, data: NewPlaythrough) -> tuple[PlaythroughView, TurnView]:
        name = clean_display_name(data.protagonist_name)
        if not name:
            raise Invalid("Enter a name for the protagonist", field="protagonist_name")
        if not is_uuid(data.scenario_id):
            raise NotFound("Scenario not found")
        if await self._routes.resolve(user_id, RouteTask.DIRECTOR) is None:
            raise AppError(
                "No director model is set up yet. Add a key and choose a model in Settings",
                code="ROUTE_MISSING",
                status=409,
            )
        prefs = Preferences.from_json(data.preferences)
        settings = {
            "protagonist": {"name": name, "summary": data.protagonist_summary.strip()[:400]},
            "preferences": {
                "length": prefs.length,
                "style": prefs.style,
                "boundaries": prefs.boundaries,
            },
        }
        async with self._engine.begin() as conn:
            scenario = await library_repo.get_scenario(conn, user_id, data.scenario_id)
            if scenario is None:
                raise NotFound("Scenario not found")
            title = (data.title or "").strip()[:80] or scenario.name
            pt = await repo.insert_playthrough(
                conn,
                user_id=user_id,
                scenario_id=scenario.id,
                title=title,
                language=parse_language(data.language),
                settings=settings,
            )
            turn = await repo.insert_turn(
                conn,
                playthrough_id=pt.id,
                seq=0,
                parent_turn_id=None,
                attempt=0,
                epoch=pt.timeline_epoch,
                user_action={"source": "opening", "text": ""},
            )
            await repo.take_lease(conn, pt.id, turn.id, ttl_s=self._lease_ttl, owner=self._instance)
        self._runners.start(header_for(pt, turn, user_id))
        return PlaythroughView.of(pt), TurnView.of(turn)

    async def list(self, user_id: str) -> list[PlaythroughView]:
        async with self._engine.connect() as conn:
            rows = await repo.list_playthroughs(conn, user_id)
        views = []
        for row in rows:
            pt = repo.PlaythroughRow.from_row(row)
            seq = row.get("head_seq")
            views.append(
                PlaythroughView.of(
                    pt,
                    head_seq=int(seq) if seq is not None else None,
                    head_excerpt=str(row.get("head_excerpt") or ""),
                )
            )
        return views

    async def _row(self, user_id: str, playthrough_id: str) -> repo.PlaythroughRow:
        if not is_uuid(playthrough_id):
            raise NotFound("Playthrough not found")
        async with self._engine.connect() as conn:
            pt = await repo.get_playthrough(conn, user_id, playthrough_id)
        if pt is None:
            raise NotFound("Playthrough not found")
        return pt

    async def get(self, user_id: str, playthrough_id: str) -> PlaythroughDetail:
        pt = await self._row(user_id, playthrough_id)
        async with self._engine.connect() as conn:
            head = await repo.get_turn(conn, pt.head_turn_id) if pt.head_turn_id else None
            active = await repo.get_turn(conn, pt.active_turn_id) if pt.active_turn_id else None
            failed = await repo.latest_failed_after(
                conn, pt.id, head.seq if head is not None else -1
            )
        return PlaythroughDetail(
            playthrough=PlaythroughView.of(
                pt,
                head_seq=head.seq if head else None,
                head_excerpt=head.narrative[:120] if head else "",
            ),
            head=TurnView.of(head) if head else None,
            active_turn=TurnView.of(active) if active else None,
            last_failed=TurnView.of(failed) if failed and active is None else None,
        )

    async def rename(self, user_id: str, playthrough_id: str, title: str) -> PlaythroughView:
        title = title.strip()[:80]
        if not title:
            raise Invalid("The title can't be empty", field="title")
        if not is_uuid(playthrough_id):
            raise NotFound("Playthrough not found")
        async with self._engine.begin() as conn:
            pt = await repo.rename_playthrough(conn, user_id, playthrough_id, title)
        if pt is None:
            raise NotFound("Playthrough not found")
        return PlaythroughView.of(pt)

    async def delete(self, user_id: str, playthrough_id: str) -> None:
        pt = await self._row(user_id, playthrough_id)
        if pt.active_turn_id:
            self._runners.cancel(pt.active_turn_id, "deleted")
        async with self._engine.begin() as conn:
            if not await repo.delete_playthrough(conn, user_id, playthrough_id):
                raise NotFound("Playthrough not found")

    async def world(self, user_id: str, playthrough_id: str, *, reveal: bool) -> WorldView:
        pt = await self._row(user_id, playthrough_id)
        async with self._engine.connect() as conn:
            snapshot = await load_world(conn, pt.id)
        hero = snapshot.protagonist
        hero_id = hero.id if hero else ""
        visible = [
            f for f in snapshot.facts if reveal or f.visibility != "secret" or hero_id in f.known_by
        ]
        return WorldView(
            entities=[
                WorldEntityView(
                    id=e.id,
                    kind=e.kind,
                    name=e.name,
                    aliases=list(e.aliases),
                    summary=e.summary,
                    data=dict(e.data),
                    importance=e.importance,
                    is_protagonist=e.is_protagonist,
                )
                for e in snapshot.entities
            ],
            links=[
                {"src_id": lk.src_id, "rel": lk.rel, "dst_id": lk.dst_id} for lk in snapshot.links
            ],
            facts=[
                WorldFactView(
                    id=f.id,
                    text=f.text,
                    entity_ids=[as_str(x) for x in f.entity_ids],
                    importance=f.importance,
                    secret=f.visibility == "secret",
                )
                for f in visible
            ],
            hidden_facts=len(snapshot.facts) - len(visible),
        )
