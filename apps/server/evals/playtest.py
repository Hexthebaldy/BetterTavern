"""剧本试玩：用一份写好的剧本代替玩家，用真模型把一局玩 N 回合（默认 100），后台同时整理世界状态，
跑完逐回合检查。

和 director_compliance.py 只测导演不同，这里走服务端的整套流程：开局搭世界、导演写叙述和选项、
回合存好后放进任务队列，由脚本里带的后台进程（和 worker 一样从队列领任务）整理世界状态。
默认写进开发数据库（DATABASE_URL），每次试玩新注册一个评测账号（playtest-时间@example.com），
所以跑完能在日志查看工具（make vis）里逐回合看导演和世界状态 agent 的每一步；不碰你自己的账号。

剧本在 datasets/m2/tavern_100.yaml：大部分回合按种子随机点选项，中间穿插专门考世界状态整理的行动
（交出和藏起物品、换地方、遇到新人物、有人死去、得知秘密），以及召回题（早先说出的细节，后面再问）。
玩家每回合之间停 --think 秒（默认 5），模拟读叙述的时间；设成 0 就是一回合接一回合地点，
用来看世界状态最多会落后多少。章节整理和大纲修订也在脚本里带的后台进程里跑，切章的线用
--chapter-soft / --chapter-hard 调（默认和服务端一样，8000 / 16000 token）。

跑完等世界状态、章节整理和大纲修订追上（最多 --settle 秒），然后用撤销记录倒推出每一回合的世界、
逐回合检查，报告写到 reports/（JSON 和一页中文总结），见 playtest_report.py、playtest_outline.py。

用法（在 apps/server 下，数据库要先 make migrate）：

    DEEPSEEK_API_KEY=sk-... uv run python -m evals.playtest \\
        --provider deepseek --model deepseek-flash

    # 后台整理用另一个模型（例如便宜、快的）：
    DEEPSEEK_API_KEY=sk-... GEMINI_API_KEY=... uv run python -m evals.playtest \\
        --provider deepseek --model deepseek-flash \\
        --state-provider gemini --state-model gemini-3-flash --state-api-key-env GEMINI_API_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import secrets as token_source
import sys
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.memory.chapters import (
    CHAPTER_HARD_TOKENS,
    CHAPTER_SOFT_TOKENS,
    ChapterRule,
)
from bettertavern.domain.world.records import FactRecord, RowChange, ThreadRecord, WorldRecords
from bettertavern.infra.crypto.keyring import AppSecrets
from bettertavern.infra.db.repositories import state as state_repo
from bettertavern.infra.db.sqlutil import as_json
from bettertavern.infra.queue.notify import PgNotifyListener
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import JobWorker
from bettertavern.providers import EndpointPolicy, ProviderHub
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.memory_runner import MemoryRunnerConfig
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.runtime.state_runner import StateRunnerConfig
from bettertavern.services.container import (
    Services,
    build_memory_runner,
    build_outline_runner,
    build_services,
    build_state_runner,
)
from bettertavern.services.memory_jobs import MEMORY_JOB, memory_handler
from bettertavern.services.outline_jobs import OUTLINE_JOB, outline_handler
from bettertavern.services.playthrough_service import NewPlaythrough
from bettertavern.services.route_inputs import RouteInput
from bettertavern.services.state_jobs import STATE_JOB, state_handler
from bettertavern.services.turn_service import ActionInput

from .playtest_checks import (
    Check,
    RecallProbe,
    evaluate_all,
    evaluate_probes,
    parse_checks,
    parse_probes,
)
from .playtest_outline import (
    OutlineWindow,
    outline_lines,
    outline_summary,
    parse_windows,
    revision_from_row,
)
from .playtest_report import RunFacts, TurnFacts, markdown, summarize, worlds_by_turn

EVALS_ROOT = Path(__file__).resolve().parent
DEFAULT_SCENARIO = EVALS_ROOT / "datasets" / "m2" / "tavern_100.yaml"
DEFAULT_OUT_DIR = EVALS_ROOT / "reports"
OPTION = "@option"
RETRY_WAIT_S = 15.0  # 一回合失败后，第 n 次重试前等 n 倍这么久


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    language: str
    protagonist: Mapping[str, str]
    preferences: Mapping[str, Any]
    card: Mapping[str, str]
    script: list[str]
    checks: list[Check] = field(default_factory=list)  # 检查点，见 playtest_checks.py
    probes: list[RecallProbe] = field(default_factory=list)  # 召回题
    outline: list[OutlineWindow] = field(default_factory=list)  # 大纲检查，见 playtest_outline.py


def load_scenario(path: Path) -> Scenario:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return Scenario(
        id=str(data["id"]),
        title=str(data["title"]),
        language=str(data.get("language") or "zh"),
        protagonist=dict(data["protagonist"]),
        preferences=dict(data.get("preferences") or {}),
        card=dict(data["card"]),
        script=[str(s) for s in data["script"]],
        checks=parse_checks(data.get("checks")),
        probes=parse_probes(data.get("recall")),
        outline=parse_windows(data.get("outline")),
    )


@dataclass(frozen=True)
class ModelChoice:
    provider: str
    model: str
    api_key: str
    base_url: str | None = None
    # 能力覆盖：测试里给假模型服务打开工具调用（{"tools": true}）
    caps_override: Mapping[str, Any] = field(default_factory=dict)


@dataclass
class ReplayConfig:
    director: ModelChoice
    state: ModelChoice | None = None  # 后台整理用的模型；不给就用导演的模型
    turns: int = 100
    think_s: float = 5.0
    seed: int = 7
    settle_s: float = 600.0
    max_attempts: int = 3  # 一回合失败后最多试几次
    scenario_path: Path = DEFAULT_SCENARIO
    chapter_rule: ChapterRule = field(default_factory=ChapterRule)  # 切章的线


@dataclass
class ReplayResult:
    playthrough_id: str
    summary: dict[str, Any]
    turns: list[TurnFacts]
    runs: list[RunFacts]
    failed_attempts: int


async def finish(services: Services, turn_id: str) -> None:
    """等这一回合的事件流结束。"""
    stream = services.buffers.get(turn_id)
    if stream is None:
        return
    async for _ in stream.subscribe(0):
        pass


def card_bytes(scenario: Scenario) -> bytes:
    return json.dumps(
        {"spec": "chara_card_v2", "spec_version": "2.0", "data": dict(scenario.card)},
        ensure_ascii=False,
    ).encode()


async def _route(services: Services, user_id: str, choice: ModelChoice, *, director: bool) -> None:
    await services.routes.create(
        user_id,
        RouteInput(
            provider=choice.provider,
            model=choice.model,
            api_key=choice.api_key,
            base_url=choice.base_url,
            caps_override=dict(choice.caps_override),
            director=director,
            background=not director,
        ),
    )


async def _state_seq(engine: AsyncEngine, playthrough_id: str) -> int:
    async with engine.connect() as conn:
        value = await conn.scalar(
            text("SELECT state_seq FROM playthroughs WHERE id = CAST(:id AS uuid)"),
            {"id": playthrough_id},
        )
    return int(value if value is not None else -1)


async def _pending_jobs(engine: AsyncEngine, playthrough_id: str) -> int:
    """这一局还没做完的后台任务：世界状态整理、章节整理、大纲修订。"""
    async with engine.connect() as conn:
        value = await conn.scalar(
            text(
                """SELECT count(*) FROM jobs WHERE ordering_key IN (:state, :memory)
                   AND status IN ('pending', 'running')"""
            ),
            {"state": f"{playthrough_id}:state", "memory": f"{playthrough_id}:memory"},
        )
    return int(value or 0)


async def run_replay(
    config: ReplayConfig,
    *,
    engine: AsyncEngine,
    secrets: AppSecrets,
    hub: ProviderHub,
    policy: EndpointPolicy,
    say: Callable[[str], None] = print,
) -> ReplayResult:
    scenario = load_scenario(config.scenario_path)
    services = build_services(
        engine=engine,
        secrets=secrets,
        hub=hub,
        policy=policy,
        buffers=EventBufferRegistry(),
        access_ttl_s=900,
        refresh_ttl_s=3600,
        runner_config=RunnerConfig(),
        instance_id=f"playtest:{os.getpid()}",
        rollback_limit=0,
    )
    state = build_state_runner(
        engine=engine, secrets=secrets, hub=hub, policy=policy, config=StateRunnerConfig()
    )
    memory = build_memory_runner(
        engine=engine,
        secrets=secrets,
        hub=hub,
        policy=policy,
        config=MemoryRunnerConfig(rule=config.chapter_rule),
    )
    outline = build_outline_runner(engine=engine, secrets=secrets, hub=hub, policy=policy)
    # 和 worker 一样从队列领整理任务；开发环境的 worker 也开着时两边一起领，不会重复整理同一回合
    queue = PgJobQueue(engine)
    listener = PgNotifyListener(engine, queue.channel)
    await listener.start()
    worker = JobWorker(
        queue,
        {
            STATE_JOB: state_handler(state),
            MEMORY_JOB: memory_handler(memory),
            OUTLINE_JOB: outline_handler(outline),
        },
        worker_id=f"playtest:{os.getpid()}",
        wakeup=listener.event,
        kinds=[STATE_JOB, MEMORY_JOB, OUTLINE_JOB],
    )
    stop = asyncio.Event()
    worker_task = asyncio.create_task(worker.run(stop))
    failed_attempts = 0
    try:
        stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        user, _ = await services.auth.register(
            f"playtest-{stamp}-{token_source.token_hex(3)}@example.com",
            token_source.token_urlsafe(18),
        )
        await _route(services, user.id, config.director, director=True)
        if config.state is not None:
            await _route(services, user.id, config.state, director=False)
        draft = await services.drafts.import_file(
            user.id, card_bytes(scenario), language=scenario.language, allow_duplicate=True
        )
        assert draft.draft is not None
        saved = await services.drafts.save(user.id, draft.draft.summary.id, new_scenario=True)
        assert saved.scenario is not None
        imported = saved.scenario
        pt, opening = await services.playthroughs.create(
            user.id,
            NewPlaythrough(
                scenario_id=imported.id,
                protagonist_name=scenario.protagonist["name"],
                protagonist_summary=scenario.protagonist.get("summary", ""),
                title=f"{scenario.title} · {stamp}",
                preferences=dict(scenario.preferences),
                language=scenario.language,
            ),
        )
        say(f"存档 {pt.id}：开局中（搭世界、写开场）……")
        await finish(services, opening.id)
        rng = random.Random(config.seed)
        for n in range(1, config.turns + 1):
            entry = scenario.script[(n - 1) % len(scenario.script)]
            shown = entry
            for attempt in range(1, config.max_attempts + 1):
                detail = await services.playthroughs.get(user.id, pt.id)
                head = detail.head
                if head is None:
                    raise RuntimeError("the opening failed; check the logs (make vis)")
                if entry == OPTION and head.options:
                    choice = rng.choice(head.options)
                    action = ActionInput(source="option", option_id=str(choice["id"]))
                    shown = f"选项：{choice['text']}"
                else:
                    text_action = entry if entry != OPTION else "我继续往前走。"
                    action = ActionInput(source="text", text=text_action)
                    shown = text_action
                turn, _ = await services.turns.create(
                    user.id, pt.id, parent_turn_id=head.id, action=action, idempotency_key=None
                )
                await finish(services, turn.id)
                done = await services.turns.get(user.id, turn.id)
                if done.status in ("replied", "committed"):
                    break
                failed_attempts += 1
                code = (done.error or {}).get("code")
                say(f"第 {n} 回合失败（{code}），第 {attempt} 次")
                if attempt == config.max_attempts:
                    raise RuntimeError(f"turn {n} failed {attempt} times: {code}")
                # 一次比一次等得久：网络断一下时，连着重试几次都会失败
                await asyncio.sleep(RETRY_WAIT_S * attempt)
            behind = n - 1 - await _state_seq(engine, pt.id)
            say(f"第 {n} 回合 · {shown[:40]} · 世界状态落后 {max(behind, 0)} 回合")
            if config.think_s:
                await asyncio.sleep(config.think_s)
        say("剧本跑完，等后台追上……")
        loop = asyncio.get_running_loop()
        deadline = loop.time() + config.settle_s
        while loop.time() < deadline:
            # 任务都做完了：剩下的是整理失败、等下一回合再试的，不会再变
            if await _pending_jobs(engine, pt.id) == 0:
                break
            await asyncio.sleep(2)
    finally:
        stop.set()
        await worker_task
        await listener.stop()
        await services.runners.shutdown(5.0)
    return await analyse(engine, pt.id, failed_attempts, scenario)


# ---- 分析：从数据库查出这一局，交给 playtest_report ---------------------------------
async def analyse(
    engine: AsyncEngine, playthrough_id: str, failed_attempts: int, scenario: Scenario
) -> ReplayResult:
    async with engine.connect() as conn:
        turn_rows = (
            await conn.execute(
                text(
                    """SELECT seq, user_action, narrative, state_seq, options_source FROM turns
                       WHERE playthrough_id = CAST(:pt AS uuid)
                         AND status IN ('replied', 'committed')
                       ORDER BY seq"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        turns = [
            TurnFacts(
                seq=int(r["seq"]),
                source=str(as_json(r["user_action"], {}).get("source") or ""),
                action=str(as_json(r["user_action"], {}).get("text") or ""),
                narrative=r["narrative"],
                state_seq=int(r["state_seq"]),
                options_source=r["options_source"],
            )
            for r in turn_rows
        ]
        run_rows = (
            await conn.execute(
                text(
                    """SELECT t.seq, r.agent, r.status, r.error_class, r.input_tokens,
                              r.cached_tokens, r.output_tokens, r.latency_ms, r.ttft_ms, r.result
                       FROM agent_runs r LEFT JOIN turns t ON t.id = r.turn_id
                       WHERE r.playthrough_id = CAST(:pt AS uuid)
                       ORDER BY r.created_at"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        runs = [
            RunFacts(
                seq=None if r["seq"] is None else int(r["seq"]),
                agent=r["agent"],
                status=r["status"],
                error_class=r["error_class"],
                input_tokens=int(r["input_tokens"] or 0),
                cached_tokens=int(r["cached_tokens"] or 0),
                output_tokens=int(r["output_tokens"] or 0),
                latency_ms=r["latency_ms"],
                ttft_ms=r["ttft_ms"],
                result=as_json(r["result"], {}),
            )
            for r in run_rows
        ]
        patch_rows = (
            await conn.execute(
                text(
                    """SELECT seq, target, before, after FROM state_patches
                       WHERE playthrough_id = CAST(:pt AS uuid) ORDER BY seq, idx"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        tool_rows = (
            await conn.execute(
                text(
                    """SELECT s.tool, count(*) AS n FROM agent_steps s
                       JOIN agent_runs r ON r.id = s.run_id
                       WHERE r.playthrough_id = CAST(:pt AS uuid) AND r.agent = 'director'
                         AND s.kind = 'tool'
                       GROUP BY s.tool ORDER BY s.tool"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        tool_calls = {str(r["tool"]): int(r["n"]) for r in tool_rows}
        summary_rows = (
            await conn.execute(
                text(
                    """SELECT kind, count(*) AS n FROM story_summaries
                       WHERE playthrough_id = CAST(:pt AS uuid) GROUP BY kind ORDER BY kind"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        summary_counts = {str(r["kind"]): int(r["n"]) for r in summary_rows}
        revision_rows = (
            await conn.execute(
                text(
                    """SELECT based_on_seq, changed, content, reason FROM outline_revisions
                       WHERE playthrough_id = CAST(:pt AS uuid) ORDER BY based_on_seq"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        revisions = [
            revision_from_row(
                int(r["based_on_seq"]), bool(r["changed"]), as_json(r["content"]), r["reason"]
            )
            for r in revision_rows
        ]
        reason_rows = (
            await conn.execute(
                text(
                    """SELECT seq, outline_reason FROM turn_notes
                       WHERE playthrough_id = CAST(:pt AS uuid) AND outline_reason <> ''
                       ORDER BY seq"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        reasons = [(int(r["seq"]), str(r["outline_reason"])) for r in reason_rows]
        patches: dict[int, list[RowChange]] = {}
        for r in patch_rows:
            patches.setdefault(int(r["seq"]), []).append(
                RowChange(r["target"], as_json(r["before"]), as_json(r["after"]))
            )
        skipped = [
            int(v)
            for v in (
                await conn.scalars(
                    text(
                        """SELECT seq FROM turn_notes
                           WHERE playthrough_id = CAST(:pt AS uuid) AND skipped ORDER BY seq"""
                    ),
                    {"pt": playthrough_id},
                )
            ).all()
        ]
        current = await state_repo.load_records(conn, playthrough_id)
        # 撤销记录里有被推翻的事实，倒推时要从完整的事实表出发
        fact_rows = (
            await conn.execute(
                text(
                    """SELECT id, text, entity_ids, visibility, known_by, status, superseded_by,
                              superseded_seq, created_seq, source_turn_id
                       FROM facts WHERE playthrough_id = CAST(:pt AS uuid)"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        facts = tuple(
            FactRecord.from_json(
                {
                    **dict(r),
                    "id": str(r["id"]),
                    "entity_ids": [str(x) for x in r["entity_ids"] or ()],
                    "known_by": [str(x) for x in r["known_by"] or ()],
                }
            )
            for r in fact_rows
        )
        # 线索也一样：解开的也要，倒推时才能变回没解开
        thread_rows = (
            await conn.execute(
                text(
                    """SELECT id, kind, text, entity_ids, status, opened_seq, closed_seq,
                              source_turn_id::text, answer, merged_into::text
                       FROM threads WHERE playthrough_id = CAST(:pt AS uuid)"""
                ),
                {"pt": playthrough_id},
            )
        ).mappings()
        threads = tuple(
            ThreadRecord.from_json(
                {
                    **dict(r),
                    "id": str(r["id"]),
                    "entity_ids": [str(x) for x in r["entity_ids"] or ()],
                }
            )
            for r in thread_rows
        )
    final_state_seq = await _state_seq(engine, playthrough_id)
    final = WorldRecords(
        entities=current.entities, links=current.links, facts=facts, threads=threads
    )
    worlds = worlds_by_turn(final, patches, final_state_seq)
    summary = summarize(
        turns,
        runs,
        worlds,
        skipped=skipped,
        final_state_seq=final_state_seq,
        checks=evaluate_all(scenario.checks, worlds, final_state_seq),
        protagonist=scenario.protagonist["name"],
        probes=evaluate_probes(
            scenario.probes,
            {t.seq: t.narrative for t in turns},
            {
                r.seq: int(r.result.get("tool_rounds") or 0)
                for r in runs
                if r.agent == "director" and r.status == "ok" and r.seq is not None
            },
        ),
        tool_calls=tool_calls,
        summaries=summary_counts,
    )
    summary["outline"] = outline_summary(revisions, reasons, runs, scenario.outline)
    summary["failed_turn_attempts"] = failed_attempts
    return ReplayResult(playthrough_id, summary, turns, runs, failed_attempts)


# ---- 命令行 ----------------------------------------------------------------------------
def _choice(args: argparse.Namespace, prefix: str) -> ModelChoice | None:
    provider = getattr(args, f"{prefix}provider")
    model = getattr(args, f"{prefix}model")
    if not provider or not model:
        return None
    env = getattr(args, f"{prefix}api_key_env") or f"{provider.upper()}_API_KEY"
    key = os.environ.get(env)
    if not key:
        flag = f"--{prefix.replace('_', '-')}api-key-env"
        sys.exit(f"没有找到 API Key：请设置环境变量 {env}（或用 {flag} 指定）")
    return ModelChoice(provider, model, key, getattr(args, f"{prefix}base_url"))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="剧本试玩：用剧本代替玩家把一局玩完，逐回合检查世界状态"
    )
    for prefix, label in (("", "导演"), ("state-", "后台整理（不给就用导演的模型）")):
        parser.add_argument(f"--{prefix}provider", required=not prefix, help=f"{label}的服务商")
        parser.add_argument(f"--{prefix}model", required=not prefix, help=f"{label}的模型名")
        parser.add_argument(f"--{prefix}api-key-env", help="放 API Key 的环境变量名")
        parser.add_argument(f"--{prefix}base-url", help="自定义的接口地址")
    parser.add_argument("--turns", type=int, default=100)
    parser.add_argument("--think", type=float, default=5.0, help="每回合之间停几秒")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--settle", type=float, default=600.0, help="跑完后最多等世界状态追上几秒")
    parser.add_argument("--scenario", type=Path, default=DEFAULT_SCENARIO)
    parser.add_argument(
        "--chapter-soft",
        type=int,
        default=CHAPTER_SOFT_TOKENS,
        help="这一章的原文超过这么多 token 以后，在下一个场景结束处切一章",
    )
    parser.add_argument(
        "--chapter-hard",
        type=int,
        default=CHAPTER_HARD_TOKENS,
        help="一直没有场景结束时，到这么多 token 硬切",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR)
    return parser.parse_args(argv)


async def _main(args: argparse.Namespace) -> None:
    from bettertavern.entrypoints.bootstrap import app_secrets, endpoint_policy, provider_hub
    from bettertavern.entrypoints.logging_setup import setup_logging
    from bettertavern.infra.db.engine import create_engine
    from bettertavern.settings import Settings

    settings = Settings()
    setup_logging(settings, "playtest")
    director = _choice(args, "")
    assert director is not None
    config = ReplayConfig(
        director=director,
        state=_choice(args, "state_"),
        turns=args.turns,
        think_s=args.think,
        seed=args.seed,
        settle_s=args.settle,
        scenario_path=args.scenario,
        chapter_rule=ChapterRule(args.chapter_soft, args.chapter_hard),
    )
    policy = endpoint_policy(settings)
    hub = provider_hub(settings, policy)
    engine = create_engine(settings.database_url)
    try:
        result = await run_replay(
            config, engine=engine, secrets=app_secrets(settings), hub=hub, policy=policy
        )
    finally:
        await hub.aclose()
        await engine.dispose()
    scenario = load_scenario(config.scenario_path)
    args.out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    base = args.out / f"playtest-{scenario.id}-{stamp}"
    report = {
        "scenario": scenario.id,
        "director": {"provider": director.provider, "model": director.model},
        "state_model": None
        if config.state is None
        else {"provider": config.state.provider, "model": config.state.model},
        "playthrough_id": result.playthrough_id,
        "chapter_rule": asdict(config.chapter_rule),
        "summary": result.summary,
        "turns": [asdict(t) | {"narrative": len(t.narrative)} for t in result.turns],
    }
    base.with_suffix(".json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    page = markdown(
        result.summary,
        title=scenario.title,
        playthrough_id=result.playthrough_id,
        extra=outline_lines(result.summary["outline"]),
    )
    base.with_suffix(".md").write_text(page, encoding="utf-8")
    print(page)
    print(f"报告：{base.with_suffix('.md')}")


def main(argv: list[str] | None = None) -> None:
    asyncio.run(_main(parse_args(argv)))


if __name__ == "__main__":
    main()
