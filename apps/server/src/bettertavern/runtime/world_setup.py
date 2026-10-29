"""开局搭世界（TurnRunner 用，docs/agent-runtime.md 第 3 节）：WorldBuilder 写开局设定
（失败或没配模型时退回只用卡片文字的最小设定），连同卡的原文快照、世界书快照、
多角色的局的角色一起存下。"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import structlog

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.cast import MIN_CAST
from bettertavern.domain.world.card_source import CardSource, snapshot_cards
from bettertavern.domain.world.lore import LoreSnapshot, build_snapshot
from bettertavern.domain.world.names import clean_display_name
from bettertavern.domain.world.seed import ProtagonistSeed, Seed, minimal_seed
from bettertavern.providers import CancelToken, ProviderError, ProviderHub
from bettertavern.providers.errors import ErrorClass
from bettertavern.providers.limiter import LimiterTimeout

from .agent import StepLog
from .agents.world_builder import build_seed, failure_run
from .ports import AgentRunRecord, RouteResolver, TurnHeader, TurnStore, WorldBuildInput
from .prompts import PromptLibrary
from .protocol.structured import StructuredOutputError

log = structlog.get_logger(__name__)

Publish = Callable[[str, dict[str, Any]], Awaitable[None]]


async def build_world(
    header: TurnHeader,
    publish: Publish,
    cancel: CancelToken,
    *,
    store: TurnStore,
    routes: RouteResolver,
    hub: ProviderHub,
    prompts: PromptLibrary,
    timeout_s: float,
    limiter_timeout_s: float,
    clock: Callable[[], float],
) -> None:
    def elapsed_ms(started: float) -> int:
        return int((clock() - started) * 1000)

    log.info("world.build.started")
    await publish("world.building", {})
    inp = await store.world_build_input(header)
    route = await routes.resolve(header.user_id, RouteTask.WORLD_BUILDER, header.playthrough_id)
    seed: Seed | None = None
    source = "minimal"
    run: AgentRunRecord | None = None
    steps = StepLog()
    started = clock()
    if route is not None and inp.card is not None:
        try:
            async with asyncio.timeout(timeout_s):
                async with hub.limiter.slot(
                    route.credential.credential_id,
                    interactive=True,
                    timeout=limiter_timeout_s,
                ):
                    result = await build_seed(
                        route,
                        hub.adapter(route.provider),
                        inp.card,
                        inp,
                        prompts=prompts,
                        negative_cache=hub.negative_cache,
                        cancel=cancel,
                        steps=steps,
                    )
            seed, source, run = result.seed, "world_builder", result.run
        except TimeoutError:
            run = failure_run(
                route, "timeout", "WorldBuilder timed out", elapsed_ms(started), steps
            )
        except ProviderError as exc:
            if exc.error_class is ErrorClass.CANCELLED:
                raise
            run = failure_run(route, exc.error_class.value, exc.message, elapsed_ms(started), steps)
        except (StructuredOutputError, LimiterTimeout) as exc:
            run = failure_run(route, type(exc).__name__, str(exc), elapsed_ms(started), steps)
    cancel.raise_if_cancelled()
    if seed is None:
        seed = fallback_seed(inp)
    cards = card_source(inp)
    lore = lore_snapshot(inp)
    count = await store.save_world(header, seed, source, run, cards, lore, cast_of(inp, cards))
    # source=minimal 表示 WorldBuilder 没成功（或没配模型），退回只用角色卡文字搭的最小世界
    log.info(
        "world.build.done",
        duration_ms=elapsed_ms(started),
        source=source,
        entities=count,
        provider=route.provider if route is not None else None,
        model=route.model if route is not None else None,
        error_class=run.error_class if run is not None else None,
    )
    await publish("world.ready", {"source": source, "entities": count})


def fallback_seed(inp: WorldBuildInput) -> Seed:
    """WorldBuilder 没写成：只用卡片文字搭最小设定；剧本已经删了时只有主角。"""
    if inp.card is not None:
        return minimal_seed(
            inp.card,
            protagonist_name=inp.protagonist_name,
            protagonist_summary=inp.protagonist_summary,
            others=inp.cards[1:],
        )
    return Seed(
        protagonist=ProtagonistSeed(name=inp.protagonist_name, summary=inp.protagonist_summary)
    )


def card_source(inp: WorldBuildInput) -> CardSource | None:
    """卡的原文快照：闪电模式放进导演的系统提示（docs/agent-runtime.md 的“闪电模式”）。
    卡里的世界书不放进来，和挂的世界书一起走世界书快照（lore_snapshot）。"""
    if not inp.cards:
        return None
    cards = snapshot_cards(inp.cards, protagonist_name=inp.protagonist_name, lore=False)
    if cards.truncated:
        log.warning("world.cards_truncated", cards=len(cards.cards), chars=cards.chars())
    return cards


def cast_of(inp: WorldBuildInput, cards: CardSource | None) -> list[tuple[str, str | None]]:
    """两张卡以上是多角色的局（docs/cast.md）：每张卡的名字（快照里换好宏的）和封面；否则为空。"""
    if cards is None or len(cards.cards) < MIN_CAST:
        return []
    covers = [*inp.covers, *([None] * len(cards.cards))]
    return [(clean_display_name(text.name), covers[i]) for i, text in enumerate(cards.cards)]


def lore_snapshot(inp: WorldBuildInput) -> LoreSnapshot:
    """这一局的世界书快照（docs/lorebook.md 第 3.2 节）：几张卡自带的和剧本挂的合成一份。
    没有世界书也存一份空的，表示这一局是世界书功能上线以后开的。"""
    lore = build_snapshot(
        inp.cards,
        inp.lorebooks,
        protagonist_name=inp.protagonist_name,
        protagonist_summary=inp.protagonist_summary,
    )
    log.info(
        "world.lore_built",
        books=len(lore.books),
        entries=len(lore.items),
        constant=sum(1 for i in lore.items if i.entry.constant),
        dropped=lore.dropped,
    )
    if lore.dropped:
        log.warning("world.lore_truncated", dropped=lore.dropped, chars=lore.chars())
    return lore
