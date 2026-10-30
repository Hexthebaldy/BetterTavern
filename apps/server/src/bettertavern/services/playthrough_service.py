"""游玩：开局（WorldBuilder 与开场回合在后台进行）、列表、详情、改名、删除、回退，
世界状态的只读视图。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.scenario.persona import (
    MAX_PERSONA_DESCRIPTION,
    PersonaChoice,
    choose_persona,
)
from bettertavern.domain.scenario.setup import ScenarioSetup
from bettertavern.domain.story.language import DEFAULT_LANGUAGE, parse_language
from bettertavern.domain.world.names import clean_display_name
from bettertavern.infra.db.repositories import cast as cast_repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import memory as memory_repo
from bettertavern.infra.db.repositories import outline as outline_repo
from bettertavern.infra.db.repositories import personas as personas_repo
from bettertavern.infra.db.repositories import rollback as rollback_repo
from bettertavern.infra.db.repositories import state as state_repo
from bettertavern.infra.db.repositories import story as repo
from bettertavern.infra.db.repositories import turn_images as images_repo
from bettertavern.infra.db.sqlutil import as_str, is_uuid
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.runtime.ports import Preferences
from bettertavern.runtime.runner import TurnRunnerPool

from .credits import CreditService
from .errors import AppError, Conflict, Invalid, NotFound
from .illustration_service import turn_images
from .outline_jobs import enqueue_outline
from .route_service import RouteService
from .state_jobs import enqueue_state
from .turn_service import header_for
from .turn_store import load_world
from .views import CastView, PlaythroughDetail, PlaythroughView, TurnView

log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class NewPlaythrough:
    """主角和偏好可以不填，用剧本的设置补上。persona_id 是人设库里的人设；
    protagonist_name 是临时填的主角（两个都给时以人设为准）。"""

    scenario_id: str
    persona_id: str | None = None
    protagonist_name: str = ""
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
    is_protagonist: bool


@dataclass(frozen=True, slots=True)
class WorldFactView:
    id: str
    text: str
    entity_ids: list[str]
    secret: bool


@dataclass(frozen=True, slots=True)
class WorldStateIssueView:
    seq: int
    kind: str  # failed：这一回合整理失败，下一回合会再试；skipped：失败两次后跳过了
    reason: str | None


@dataclass(frozen=True, slots=True)
class WorldView:
    entities: list[WorldEntityView]
    links: list[dict[str, str]]
    facts: list[WorldFactView]
    hidden_facts: int
    state_seq: int  # 世界状态已整理到第几回合，-1 表示还是开局时的样子
    state_issue: WorldStateIssueView | None


async def _protagonist(
    conn: Any, user_id: str, data: NewPlaythrough, setup: ScenarioSetup
) -> dict[str, Any]:
    """这一局的主角（docs/personas.md 第 3 节）：请求里的人设 → 请求里临时填的 → 剧本选的人设
    → 剧本设置里旧版 App 写的默认主角 → 默认人设。用人设时记下 persona_id（只用来显示头像）。"""
    if data.persona_id is not None:
        persona = (
            await personas_repo.get_persona(conn, user_id, data.persona_id)
            if is_uuid(data.persona_id)
            else None
        )
        if persona is None:
            raise Invalid("That persona doesn't exist", field="persona_id")
        return _from_persona(persona)
    name = clean_display_name(data.protagonist_name)
    if name:
        return {"name": name, "summary": data.protagonist_summary.strip()[:MAX_PERSONA_DESCRIPTION]}
    personas = await personas_repo.list_personas(conn, user_id)
    chosen = choose_persona(setup.persona_id, [PersonaChoice(p.id, p.is_default) for p in personas])
    if chosen is not None and (not setup.protagonist_name or chosen == setup.persona_id):
        return _from_persona(next(p for p in personas if p.id == chosen))
    if setup.protagonist_name:
        return {"name": setup.protagonist_name, "summary": setup.protagonist_summary}
    raise Invalid("Enter a name for the protagonist", field="protagonist_name")


def _from_persona(persona: personas_repo.PersonaRow) -> dict[str, Any]:
    return {
        "name": clean_display_name(persona.name),
        "summary": persona.description,
        "persona_id": persona.id,
    }


class PlaythroughService:
    def __init__(
        self,
        engine: AsyncEngine,
        routes: RouteService,
        runners: TurnRunnerPool,
        *,
        lease_ttl_s: float,
        instance_id: str,
        rollback_limit: int = 1,
        credits: CreditService | None = None,
    ) -> None:
        self._engine = engine
        self._routes = routes
        self._credits = credits
        self._runners = runners
        self._lease_ttl = lease_ttl_s
        self._instance = instance_id
        self._queue = PgJobQueue(engine)
        self._rollback_limit = rollback_limit

    def rollback_limit(self, user_id: str) -> int:
        """这个用户每个存档能回退几次。现在人人一样；以后按用户（例如充值用户 3 次）在这里查。"""
        return self._rollback_limit

    def _view(
        self, pt: repo.PlaythroughRow, *, head_seq: int | None = None, head_excerpt: str = ""
    ) -> PlaythroughView:
        return PlaythroughView.of(
            pt,
            rollback_limit=self.rollback_limit(pt.user_id),
            head_seq=head_seq,
            head_excerpt=head_excerpt,
        )

    async def create(self, user_id: str, data: NewPlaythrough) -> tuple[PlaythroughView, TurnView]:
        """没填的主角和偏好用剧本的设置（scenarios.setup）补上；开场白的选择也取自设置，记进这一局。"""
        if not is_uuid(data.scenario_id):
            raise NotFound("Scenario not found")
        director = await self._routes.resolve(user_id, RouteTask.DIRECTOR)
        if director is None:
            raise AppError(
                "No director model is set up yet. Add a key and choose a model in Settings",
                code="ROUTE_MISSING",
                status=409,
            )
        if self._credits is not None:
            await self._credits.check_route(user_id, director)
        async with self._engine.begin() as conn:
            scenario = await library_repo.get_scenario(conn, user_id, data.scenario_id)
            if scenario is None:
                raise NotFound("Scenario not found")
            if not scenario.cards:  # 迁移前的旧数据才可能出现
                raise Invalid("This scenario has no character card", field="scenario_id")
            setup = ScenarioSetup.from_json(scenario.setup)
            protagonist = await _protagonist(conn, user_id, data, setup)
            prefs = (
                Preferences.from_json(data.preferences)
                if data.preferences is not None
                else Preferences(
                    length=setup.length, style=setup.style, boundaries=setup.boundaries
                )
            )
            settings: dict[str, Any] = {
                "protagonist": protagonist,
                "preferences": {
                    "length": prefs.length,
                    "style": prefs.style,
                    "boundaries": prefs.boundaries,
                },
            }
            if setup.opening is not None:
                settings["opening"] = {
                    "card_id": setup.opening.card_id,
                    "greeting": setup.opening.greeting,
                }
            title = (data.title or "").strip()[:80] or scenario.name
            pt = await repo.insert_playthrough(
                conn,
                user_id=user_id,
                scenario_id=scenario.id,
                title=title,
                language=parse_language(data.language),
                settings=settings,
                # 闪电模式在开局时定下，之后改剧本不影响这一局
                mode="lightning" if setup.lightning else "standard",
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
        return self._view(pt), TurnView.of(turn)

    async def list(self, user_id: str) -> list[PlaythroughView]:
        async with self._engine.connect() as conn:
            rows = await repo.list_playthroughs(conn, user_id)
        views = []
        for row in rows:
            pt = repo.PlaythroughRow.from_row(row)
            seq = row.get("head_seq")
            views.append(
                self._view(
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
            cast = await cast_repo.list_cast(conn, pt.id)
            images = await turn_images(conn, [head.id] if head is not None else [])
        return PlaythroughDetail(
            playthrough=self._view(
                pt,
                head_seq=head.seq if head else None,
                head_excerpt=head.narrative[:120] if head else "",
            ),
            head=TurnView.of(head, images.get(head.id)) if head else None,
            active_turn=TurnView.of(active) if active else None,
            last_failed=TurnView.of(failed) if failed and active is None else None,
            cast=[CastView.of(c) for c in cast],
        )

    async def set_muted(
        self, user_id: str, playthrough_id: str, position: int, muted: bool
    ) -> list[CastView]:
        """多角色的局里让一个角色先不出场，或者回来（docs/cast.md）。整局记着，回退也不改。"""
        pt = await self._row(user_id, playthrough_id)
        async with self._engine.begin() as conn:
            if not await cast_repo.set_muted(conn, pt.id, position, muted):
                raise NotFound("Cast member not found")
            cast = await cast_repo.list_cast(conn, pt.id)
        log.info("playthrough.cast_muted", playthrough_id=pt.id, position=position, muted=muted)
        return [CastView.of(c) for c in cast]

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
        return self._view(pt)

    async def rollback(self, user_id: str, playthrough_id: str, turn_id: str) -> PlaythroughDetail:
        """回退到 turn_id 那一回合（docs/agent-runtime.md 第 8 节），一个事务。

        撤销之后各回合对世界状态的修改、删掉它们的回合标签、删掉覆盖范围超过这一回合的章节摘要和
        全书梗概（玩家画像不动）、删掉依据超过这一回合的大纲修订、把之后的回合（连同失败的尝试）
        归档、头部指回这一回合、时间线编号加 1、回退次数加 1。有回合正在生成时不回退。
        """
        if not is_uuid(playthrough_id) or not is_uuid(turn_id):
            raise NotFound("Playthrough not found")
        limit = self.rollback_limit(user_id)
        async with self._engine.begin() as conn:
            pt = await repo.get_playthrough(conn, user_id, playthrough_id, lock=True)
            if pt is None:
                raise NotFound("Playthrough not found")
            if pt.active_turn_id is not None:
                if await repo.lease_alive(conn, pt.id):
                    raise Conflict(
                        "A turn is still being written; stop it first",
                        code="TURN_IN_PROGRESS",
                        active_turn_id=pt.active_turn_id,
                    )
                # 租约已过期：生成进程没了，先把那一轮标为失败
                await repo.fail_turn(
                    conn, pt.active_turn_id, narrative="", error=repo.RUNNER_LOST_ERROR
                )
                await repo.release_lease(conn, pt.id, pt.active_turn_id)
            target = await repo.get_turn(conn, turn_id)
            if target is None or target.playthrough_id != pt.id:
                raise NotFound("Turn not found")
            if target.status not in ("replied", "committed"):
                raise Conflict("That turn is no longer in the story", code="NOT_ON_TIMELINE")
            if target.id == pt.head_turn_id:
                raise Conflict("The story is already at that turn", code="ALREADY_AT_TURN")
            if pt.rollbacks_used >= limit:
                raise Conflict(
                    "This save has no rollbacks left", code="ROLLBACK_LIMIT_REACHED", limit=limit
                )
            undo = await rollback_repo.patches_after(conn, pt.id, target.seq)
            await state_repo.apply_changes(conn, pt.id, rollback_repo.inverted(undo))
            patches, notes = await rollback_repo.delete_after(conn, pt.id, target.seq)
            summaries = await memory_repo.delete_after(conn, pt.id, target.seq)
            revisions = await outline_repo.delete_after(conn, pt.id, target.seq)
            archived = await rollback_repo.archive_after(conn, pt.id, target.seq, str(uuid.uuid4()))
            await rollback_repo.move_head(conn, pt.id, target.id, target.seq)
            # 世界状态还没整理到这一回合：接着整理（回退前开始的整理写入时会作废）
            if pt.state_seq < target.seq:
                await enqueue_state(conn, self._queue, pt.id)
            # 删了大纲修订：留下的回合里可能还有没处理的“要改”的原因，或者连第一版都没了
            if revisions:
                await enqueue_outline(conn, self._queue, pt.id)
        log.info(
            "playthrough.rolled_back",
            playthrough_id=pt.id,
            to_seq=target.seq,
            undone_rows=len(undo),
            deleted_patches=patches,
            deleted_notes=notes,
            deleted_summaries=summaries,
            deleted_revisions=revisions,
            archived_turns=archived,
            state_seq=min(pt.state_seq, target.seq),
        )
        return await self.get(user_id, playthrough_id)

    async def delete(self, user_id: str, playthrough_id: str) -> None:
        pt = await self._row(user_id, playthrough_id)
        if pt.active_turn_id:
            self._runners.cancel(pt.active_turn_id, "deleted")
        async with self._engine.begin() as conn:
            # 这一局的配图：行跟着级联删除，图片没有别处在用时一起删掉
            blobs = await images_repo.playthrough_blobs(conn, pt.id)
            if not await repo.delete_playthrough(conn, user_id, playthrough_id):
                raise NotFound("Playthrough not found")
            await library_repo.delete_orphan_blobs(conn, user_id, blobs)

    async def world(self, user_id: str, playthrough_id: str, *, reveal: bool) -> WorldView:
        pt = await self._row(user_id, playthrough_id)
        async with self._engine.connect() as conn:
            snapshot = await load_world(conn, pt.id)
            issue = await state_repo.state_issue(conn, pt.id, state_seq=pt.state_seq)
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
                    secret=f.visibility == "secret",
                )
                for f in visible
            ],
            hidden_facts=len(snapshot.facts) - len(visible),
            state_seq=pt.state_seq,
            state_issue=None
            if issue is None
            else WorldStateIssueView(seq=issue.seq, kind=issue.kind, reason=issue.reason),
        )
