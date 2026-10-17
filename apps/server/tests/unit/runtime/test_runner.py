"""TurnRunner 的行为：事件顺序、修复阶梯、结局、重试与 fallback、半截失败、取消、租约与开局构建。"""

from __future__ import annotations

import asyncio
import json

import pytest

from bettertavern.domain.routing import RouteParams, RouteTask
from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.infra.db.repositories.story import RUNNER_LOST_ERROR
from bettertavern.providers import CancelToken, ProviderError, ProviderHub
from bettertavern.providers.errors import ErrorClass
from bettertavern.runtime.events.buffer import EventBufferRegistry, EventStream
from bettertavern.runtime.ports import Preferences, WorldBuildInput
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.runner import LEASE_LOST, RunnerConfig, TurnRunner, TurnRunnerPool
from tests.fakes.runtime import (
    FakeRoutes,
    FakeStore,
    StreamScript,
    header,
    make_route,
    result,
    scripted_hub,
)

pytestmark = pytest.mark.anyio

GOOD = (
    "<narrative>\n我推开门，雨声小了。\n</narrative>\n<options>\n1. 走进去\n2. 退回去\n</options>"
)
CONFIG = RunnerConfig(delta_batch_s=0.0, lease_renew_s=0.05, barrier_timeout_s=0.2)


def pieces(text: str, size: int = 7) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


async def run_turn(
    store: FakeStore,
    routes: FakeRoutes,
    hub: ProviderHub,
    *,
    seq: int = 1,
    world_ready: bool = True,
) -> list[tuple[str, dict[str, object]]]:
    runner = TurnRunner(
        store=store,
        routes=routes,
        hub=hub,
        prompts=PromptLibrary("zh"),
        config=CONFIG,
    )
    stream = EventStream("turn-1")
    await runner.run(header(seq, world_ready=world_ready), stream, CancelToken())
    return [(e.event, json.loads(e.data)) for e in stream.snapshot()]


async def test_happy_path_events_and_commit() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    store = FakeStore()
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    names = [e for e, _ in events]
    assert names[0] == "turn.created"
    assert names[-2:] == ["options.ready", "turn.completed"]
    assert names.count("narrative.done") == 1
    text = "".join(str(d["text"]) for e, d in events if e == "narrative.delta")
    outcome = store.committed[0]
    assert text == outcome.narrative == "我推开门，雨声小了。"
    assert [o.text for o in outcome.options] == ["走进去", "退回去"]
    assert outcome.options_source == "model"
    run = outcome.runs[0]
    assert run.agent == "director" and run.status == "ok" and run.usage is not None
    assert run.result["stage"] == "ok"
    completed = events[-1][1]["turn"]
    assert isinstance(completed, dict) and completed["narrative"] == outcome.narrative


async def test_missing_options_go_through_repair() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces("<narrative>\n只有叙述。\n</narrative>")))
    adapters["fake"].completions.append(result('{"options": ["修一", "修二"]}'))
    store = FakeStore()
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert events[-2][1] == {
        "options": [{"id": "o1", "text": "修一"}, {"id": "o2", "text": "修二"}],
        "source": "repaired",
    }


async def test_repair_failure_falls_back_to_default_options() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces("<narrative>\n只有叙述。\n</narrative>")))
    adapters["fake"].completions.append(ProviderError(ErrorClass.SERVER_ERROR, "boom"))
    store = FakeStore()
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert store.committed[0].options_source == "fallback"
    assert len(store.committed[0].options) == 2


async def test_ending_keeps_only_the_narrative_and_ends_the_story() -> None:
    hub, adapters = scripted_hub("fake")
    # 模型照习惯写了选项：结局不要，丢掉，也不另调模型补
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    store = FakeStore(action=PlayerAction("ending", "和阿苓一起离开小镇"))
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    outcome = store.committed[0]
    assert outcome.ends_story is True
    assert outcome.narrative == "我推开门，雨声小了。"
    assert outcome.options == [] and outcome.options_source is None
    assert len(adapters["fake"].requests) == 1
    assert events[-2] == ("options.ready", {"options": [], "source": None})
    completed = events[-1][1]["turn"]
    assert isinstance(completed, dict) and completed["options"] == []
    # 发给导演的最后一条消息是结局要求，带着玩家写的方向
    final_prompt = adapters["fake"].requests[0].messages[-1].content
    assert "<ending-wish>" in final_prompt and "和阿苓一起离开小镇" in final_prompt
    assert "<player-action>" not in final_prompt


async def test_ending_without_options_is_not_counted_as_a_repair() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(
        StreamScript(pieces("<narrative>\n雨停了。全文完。\n</narrative>"))
    )
    store = FakeStore(action=PlayerAction("ending", ""))
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    outcome = store.committed[0]
    assert outcome.narrative == "雨停了。全文完。" and outcome.ends_story is True
    assert outcome.runs[0].result["stage"] == "ending"
    assert outcome.runs[0].result["repairs"] == []
    # 玩家没写方向：提示词里没有空的方向块
    assert "<ending-wish>" not in adapters["fake"].requests[0].messages[-1].content


async def test_failed_ending_does_not_end_the_story() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces("<options>\n1. 甲\n2. 乙\n</options>")))
    store = FakeStore(action=PlayerAction("ending", ""))
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert store.committed == []
    assert store.failed[0].code == "NARRATIVE_MISSING" and store.failed[0].retryable
    assert events[-1][0] == "turn.failed"


async def test_ordinary_turns_do_not_end_the_story() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    store = FakeStore()
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert store.committed[0].ends_story is False


async def test_error_before_text_switches_to_fallback_route() -> None:
    hub, adapters = scripted_hub("primary", "backup")
    bad = ProviderError(ErrorClass.BILLING, "no money", status=402)  # 不可重试，但允许 fallback
    adapters["primary"].streams.append(StreamScript(["x"], error=bad, error_after=0))
    adapters["backup"].streams.append(StreamScript(pieces(GOOD)))
    route = make_route("primary", fallback=make_route("backup"))
    store = FakeStore()
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: route}), hub)
    outcome = store.committed[0]
    assert outcome.runs[0].provider == "backup"
    assert outcome.runs[0].result["fallback_used"] is True


async def test_overflow_with_stated_limit_learns_the_window() -> None:
    hub, adapters = scripted_hub("fake")
    too_long = ProviderError(
        ErrorClass.CONTEXT_OVERFLOW,
        "This model's maximum context length is 32768 tokens. However, you requested 60000 tokens",
        status=400,
    )
    adapters["fake"].streams.append(StreamScript(["x"], error=too_long, error_after=0))
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    route = make_route(window=131072)
    routes = FakeRoutes({RouteTask.DIRECTOR: route})
    store = FakeStore()
    await run_turn(store, routes, hub)
    # 报错里写明的上限记到这个路由上，这一轮按 32K 重新装配后成功
    assert routes.learned == [(route.route_id, 32768)]
    assert store.committed and store.committed[0].narrative == "我推开门，雨声小了。"


async def test_overflow_without_limit_retries_smaller_but_learns_nothing() -> None:
    hub, adapters = scripted_hub("fake")
    too_long = ProviderError(ErrorClass.CONTEXT_OVERFLOW, "context length exceeded", status=400)
    adapters["fake"].streams.append(StreamScript(["x"], error=too_long, error_after=0))
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    routes = FakeRoutes({RouteTask.DIRECTOR: make_route()})
    store = FakeStore()
    await run_turn(store, routes, hub)
    assert routes.learned == []
    assert store.committed


async def test_interrupted_stream_keeps_partial_narrative() -> None:
    hub, adapters = scripted_hub("fake")
    broken = ProviderError(ErrorClass.STREAM_INTERRUPTED, "connection reset")
    adapters["fake"].streams.append(StreamScript(pieces(GOOD, 4), error=broken, error_after=5))
    store = FakeStore()
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    failure = store.failed[0]
    assert failure.partial and failure.retryable
    streamed = "".join(str(d["text"]) for e, d in events if e == "narrative.delta")
    assert failure.narrative == streamed and streamed
    assert events[-1][0] == "turn.failed" and events[-1][1]["partial"] is True
    assert not store.committed


async def test_endless_output_is_cut_at_the_length_cap() -> None:
    # 不守规矩的接口：max_tokens 只有 64，却一直往回写（这里准备了 1 万段，远超上限）
    hub, adapters = scripted_hub("fake")
    endless = ["<narrative>\n"] + ["雨还在下，" * 4] * 10_000
    adapters["fake"].streams.append(StreamScript(endless))
    route = make_route(params=RouteParams(max_tokens=64))
    store = FakeStore()
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: route}), hub)
    failure = store.failed[0]
    assert failure.code == "OUTPUT_TOO_LONG" and failure.retryable and failure.partial
    streamed = "".join(str(d["text"]) for e, d in events if e == "narrative.delta")
    assert failure.narrative == streamed and 0 < len(streamed) <= 64 * 8
    assert events[-1][0] == "turn.failed" and events[-1][1]["code"] == "OUTPUT_TOO_LONG"
    # 碰到上限就停：没有把 1 万段都读完，流也当场关掉了，没有重试
    assert adapters["fake"].yielded < 100
    assert adapters["fake"].closed == 1 and len(adapters["fake"].requests) == 1
    assert not store.committed


async def test_slow_endless_stream_is_cut_at_the_time_limit() -> None:
    # 一直在写、但永远写不完：每段之间不超时，只有总时长上限能停下它
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(["<narrative>\n"] + ["雾"] * 10_000, delay=0.01))
    store = FakeStore()
    runner = TurnRunner(
        store=store,
        routes=FakeRoutes({RouteTask.DIRECTOR: make_route()}),
        hub=hub,
        prompts=PromptLibrary("zh"),
        config=RunnerConfig(delta_batch_s=0.0, lease_renew_s=0.05, director_timeout_s=0.3),
    )
    stream = EventStream("turn-1")
    loop = asyncio.get_running_loop()
    started = loop.time()
    await runner.run(header(), stream, CancelToken())
    assert loop.time() - started < 2
    failure = store.failed[0]
    assert failure.code == "GENERATION_TIMEOUT" and failure.retryable and failure.partial
    assert "0.3 秒" in failure.message and failure.narrative.startswith("雾")
    assert adapters["fake"].closed == 1
    assert not store.committed


async def test_auth_error_is_not_retryable() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(
        StreamScript(["x"], error=ProviderError(ErrorClass.AUTH, "bad key", status=401))
    )
    store = FakeStore()
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert store.failed[0].code == "CREDENTIAL_INVALID"
    assert events[-1][1]["retryable"] is False


async def test_missing_narrative_fails_the_turn() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(["   "]))
    store = FakeStore()
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert store.failed[0].code == "NARRATIVE_MISSING" and store.failed[0].retryable


async def test_no_route_configured() -> None:
    hub, _ = scripted_hub("fake")
    store = FakeStore()
    events = await run_turn(store, FakeRoutes({}), hub)
    assert store.failed[0].code == "ROUTE_MISSING"
    assert events[-1][0] == "turn.failed"


async def test_stale_commit_reports_the_same_error_as_the_sweeper() -> None:
    """租约被清理任务收走后提交被拒：事件流里的错误与库里的一致（可以重试）"""
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    store = FakeStore(commit_ok=False)
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    name, data = events[-1]
    assert name == "turn.failed"
    assert data["code"] == "RUNNER_LOST" and data["retryable"] is True
    assert [f.code for f in store.failed] == ["RUNNER_LOST"]
    assert "options.ready" not in [e for e, _ in events]


async def test_barrier_timeout_marks_state_lag() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    store = FakeStore(parent_committed_after=5.0)
    events = await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    waits = [d for e, d in events if e == "turn.waiting_state"]
    assert len(waits) == 2 and waits[-1]["lag"] is True
    assert store.committed[0].state_lag is True


async def test_lost_lease_cancels_generation() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces(GOOD, 2), delay=0.02))
    store = FakeStore(renew_ok=False)
    await run_turn(store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub)
    assert store.failed and store.failed[0].code == "CANCELLED"
    assert not store.committed


async def test_opening_builds_world_and_falls_back_to_minimal_seed() -> None:
    hub, adapters = scripted_hub("fake")
    # WorldBuilder 的结构化输出连续两次不合格 → 失败 → 最小 Seed
    adapters["fake"].completions.extend([result("不是 JSON"), result("还不是")])
    adapters["fake"].streams.append(StreamScript(pieces(GOOD)))
    card = CharacterCard(spec="card_v2", name="阿苓", description="酒馆帮工", first_mes="外乡人？")
    store = FakeStore(
        world_input=WorldBuildInput(
            card=card, protagonist_name="林川", protagonist_summary="", preferences=Preferences()
        )
    )

    store.action = PlayerAction("opening", "")
    events = await run_turn(
        store, FakeRoutes({RouteTask.DIRECTOR: make_route()}), hub, seq=0, world_ready=False
    )
    names = [e for e, _ in events]
    assert names[:3] == ["turn.created", "world.building", "world.ready"]
    seed, source, run = store.saved_world[0]
    assert source == "minimal" and run is not None and run.status == "failed"
    assert seed.protagonist.name == "林川"
    final_prompt = adapters["fake"].requests[-1].messages[-1].content
    assert "<opening-brief>" in final_prompt and "外乡人？" in final_prompt


async def test_pool_shutdown_cancels_slow_turns() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript(pieces(GOOD, 1), delay=0.05))
    store = FakeStore()
    runner = TurnRunner(
        store=store,
        routes=FakeRoutes({RouteTask.DIRECTOR: make_route()}),
        hub=hub,
        prompts=PromptLibrary("zh"),
        config=RunnerConfig(delta_batch_s=0.0, lease_renew_s=10),
    )
    pool = TurnRunnerPool(runner, EventBufferRegistry())
    stream = pool.start(header())
    assert pool.is_running("turn-1")
    await asyncio.sleep(0.1)
    await pool.shutdown(grace=0.05)
    assert not pool.is_running("turn-1")
    assert store.failed and store.failed[0].code == "CANCELLED"
    assert stream.closed


def test_lease_lost_error_matches_what_the_sweeper_stores() -> None:
    assert LEASE_LOST.to_json() == RUNNER_LOST_ERROR
