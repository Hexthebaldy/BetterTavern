"""IllustrationStore 的 Postgres 实现（docs/illustrations.md 第 2 节）：给后台配图读材料、存图。

材料：这一回合的行动和正文、上一回合的结尾、世界的设定和此刻的地点，以及画里可能有的人：
- 主角：玩家写的主角设定（没写时用开局设定里的），用人设开局的带上人设的头像当参考图；
- 卡里的角色：开局时卡的描述（playthroughs.seed 的 cards），封面取这一局记下的（多角色的局）
  或剧本里那张卡现在的封面；
- 世界状态里此刻在场、又不是卡里角色的人：只有世界状态里的描述，没有参考图。

存图时先做带条件的 UPDATE（还在画、没超时才改成 ready），再写图片、删掉这一回合旧的图。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.story.illustration import DEADLINE_S
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.domain.world.card_source import CardText
from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import WorldSnapshot
from bettertavern.infra.db.repositories import cast as cast_repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import personas as personas_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.infra.db.repositories import turn_images as images_repo
from bettertavern.runtime.ports import (
    AgentRunRecord,
    IllustrationDone,
    IllustrationWork,
    SceneFigure,
    StorageFull,
)

from .quotas import Quotas, lock_user, storage_left
from .run_records import insert_run
from .turn_store import cards_of, load_world, scenario_cards

MAX_CARD_FIGURES = 6
MAX_EXTRA_FIGURES = 4


class _Stale(Exception):
    """这一行已经不在画了（玩家删了、超时了）：回滚整个事务。"""


def scene_figures(
    *,
    protagonist: tuple[str, str, str | None],
    cards: Sequence[CardText],
    covers: Mapping[str, str | None],
    world: WorldSnapshot,
) -> tuple[SceneFigure, ...]:
    """画里可能有的人：主角（名字，描述，头像）、卡里的角色（covers 按 normalize_name 后的名字
    找封面）、世界状态里此刻在场的其他人。名字重复的只留第一个。"""
    figures: list[SceneFigure] = []
    seen: set[str] = set()

    def add(figure: SceneFigure) -> None:
        key = normalize_name(figure.name)
        if not key or key in seen:
            return
        seen.add(key)
        figures.append(figure)

    name, description, avatar = protagonist
    add(SceneFigure(name=name, description=description, blob_id=avatar, protagonist=True))
    for card in list(cards)[:MAX_CARD_FIGURES]:
        add(
            SceneFigure(
                name=card.name,
                description=card.description,
                blob_id=covers.get(normalize_name(card.name)),
            )
        )
    known = {normalize_name(f.name) for f in figures}
    _, present = world.scene()
    extra = 0
    for person in present:
        names = {normalize_name(person.name), *(normalize_name(a) for a in person.aliases)}
        if names & known or extra >= MAX_EXTRA_FIGURES:
            continue
        add(SceneFigure(name=person.name, description=person.summary))
        extra += 1
    return tuple(figures)


def _world_text(seed: Seed | None) -> str:
    if seed is None:
        return ""
    world = seed.world
    return "\n".join(part for part in (world.title, world.setting, world.tone) if part)


def _location_text(world: WorldSnapshot) -> str:
    location, _ = world.scene()
    if location is None:
        return ""
    return f"{location.name}: {location.summary}" if location.summary else location.name


class PgIllustrationStore:
    def __init__(self, engine: AsyncEngine, quotas: Quotas | None = None) -> None:
        self._engine = engine
        self._quotas = quotas or Quotas()

    async def load(self, image_id: str) -> IllustrationWork | None:
        async with self._engine.connect() as conn:
            image = await images_repo.get_image(conn, image_id)
            if image is None or image.status != "pending":
                return None
            pt = await story_repo.get_playthrough_by_id(conn, image.playthrough_id)
            turn = await story_repo.get_turn(conn, image.turn_id)
            if pt is None or turn is None:
                return None
            previous = ""
            if turn.parent_turn_id:
                parent = await story_repo.get_turn(conn, turn.parent_turn_id)
                previous = parent.narrative if parent is not None else ""
            world = await load_world(conn, pt.id)
            seed = Seed.model_validate(pt.seed) if pt.seed else None
            snapshot = cards_of(pt.seed)
            covers = await self._covers(conn, pt)
            chosen = pt.settings.get("protagonist") or {}
            avatar = await self._avatar(conn, pt.user_id, chosen.get("persona_id"))
        hero = world.protagonist
        name = str(chosen.get("name") or (seed.protagonist.name if seed else "") or "")
        description = str(
            chosen.get("summary")
            or (hero.summary if hero is not None else "")
            or (seed.protagonist.summary if seed else "")
        )
        action = PlayerAction.from_json(turn.user_action)
        return IllustrationWork(
            image_id=image.id,
            user_id=image.user_id,
            playthrough_id=pt.id,
            turn_id=turn.id,
            language=pt.language,
            age_s=image.age_s,
            request=image.request,
            style=image.style,
            world=_world_text(seed),
            location=_location_text(world),
            action=action.text if action.source in ("text", "option") else "",
            narrative=turn.narrative,
            previous=previous,
            figures=scene_figures(
                protagonist=(name, description, avatar),
                cards=snapshot.cards if snapshot is not None else (),
                covers=covers,
                world=world,
            ),
        )

    async def _covers(
        self, conn: AsyncConnection, pt: story_repo.PlaythroughRow
    ) -> dict[str, str | None]:
        """角色名（normalize_name 后）→ 封面：多角色的局用开局时记下的，
        否则看剧本里那张卡现在的。"""
        cast = await cast_repo.list_cast(conn, pt.id)
        if cast:
            return {normalize_name(c.name): c.cover_blob_id for c in cast}
        cards = await scenario_cards(conn, pt.user_id, pt.scenario_id)
        return {normalize_name(card.name): cover for _, card, cover in cards}

    async def _avatar(self, conn: AsyncConnection, user_id: str, persona_id: Any) -> str | None:
        if not isinstance(persona_id, str) or not persona_id:
            return None
        persona = await personas_repo.get_persona(conn, user_id, persona_id)
        return persona.avatar_blob_id if persona is not None else None

    async def image_bytes(self, user_id: str, blob_id: str) -> tuple[bytes, str] | None:
        async with self._engine.connect() as conn:
            blob = await library_repo.get_blob(conn, user_id, blob_id)
        return None if blob is None else (blob.data, blob.mime)

    async def commit(self, work: IllustrationWork, done: IllustrationDone) -> bool:
        image = done.image
        try:
            async with self._engine.begin() as conn:
                claimed = await images_repo.claim_ready(
                    conn, work.image_id, deadline_s=DEADLINE_S, prompt=done.prompt, meta=done.meta
                )
                if not claimed:
                    raise _Stale
                await lock_user(conn, work.user_id)
                if await storage_left(conn, work.user_id, self._quotas) < len(image.data):
                    raise StorageFull
                blob_id = await library_repo.insert_blob(
                    conn,
                    user_id=work.user_id,
                    sha256=image.sha256,
                    mime=image.mime,
                    data=image.data,
                    width=image.width,
                    height=image.height,
                )
                await images_repo.set_blob(conn, work.image_id, blob_id)
                dropped = await images_repo.delete_others(conn, work.turn_id, work.image_id)
                await library_repo.delete_orphan_blobs(conn, work.user_id, dropped)
                if done.run is not None:
                    await self._insert_run(conn, work, done.run)
        except _Stale:
            if done.run is not None:
                # 写画面描述的那次调用照样记下（用官方模型时照样扣点数）
                async with self._engine.begin() as conn:
                    await self._insert_run(conn, work, done.run)
            return False
        return True

    async def fail(
        self,
        work: IllustrationWork,
        error: str,
        *,
        prompt: str | None = None,
        meta: Mapping[str, Any] | None = None,
        run: AgentRunRecord | None = None,
    ) -> None:
        async with self._engine.begin() as conn:
            await images_repo.mark_failed(
                conn, work.image_id, error=error, prompt=prompt, meta=meta
            )
            if run is not None:
                await self._insert_run(conn, work, run)

    async def _insert_run(
        self, conn: AsyncConnection, work: IllustrationWork, run: AgentRunRecord
    ) -> None:
        await insert_run(
            conn,
            run,
            user_id=work.user_id,
            playthrough_id=work.playthrough_id,
            turn_id=work.turn_id,
        )
