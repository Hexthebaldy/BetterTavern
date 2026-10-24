"""剧本试玩（playtest.py）跑完以后：从数据库查出这一局的回合、agent 运行、撤销记录、摘要和大纲，
交给 playtest_report.py、playtest_outline.py、playtest_lightning.py 分析。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.world.records import FactRecord, RowChange, ThreadRecord, WorldRecords
from bettertavern.infra.db.repositories import state as state_repo
from bettertavern.infra.db.sqlutil import as_json

from .playtest_checks import evaluate_all, evaluate_probes
from .playtest_lightning import compress_summary, cost_summary
from .playtest_outline import outline_summary, revision_from_row
from .playtest_report import RunFacts, TurnFacts, summarize, worlds_by_turn

if TYPE_CHECKING:
    from .playtest import Scenario


@dataclass
class ReplayResult:
    playthrough_id: str
    summary: dict[str, Any]
    turns: list[TurnFacts]
    runs: list[RunFacts]
    failed_attempts: int


async def state_seq(engine: AsyncEngine, playthrough_id: str) -> int:
    async with engine.connect() as conn:
        value = await conn.scalar(
            text("SELECT state_seq FROM playthroughs WHERE id = CAST(:id AS uuid)"),
            {"id": playthrough_id},
        )
    return int(value if value is not None else -1)


async def analyse(
    engine: AsyncEngine,
    playthrough_id: str,
    failed_attempts: int,
    scenario: Scenario,
    *,
    lightning: bool = False,
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
    final_state_seq = await state_seq(engine, playthrough_id)
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
        # 检查点考的是世界状态，闪电模式没有
        checks=() if lightning else evaluate_all(scenario.checks, worlds, final_state_seq),
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
        lightning=lightning,
    )
    summary["outline"] = outline_summary(revisions, reasons, runs, scenario.outline)
    summary["cost"] = cost_summary(runs, len(turns))
    if lightning:
        summary["lightning"] = compress_summary(runs, summary_counts)
    summary["failed_turn_attempts"] = failed_attempts
    return ReplayResult(playthrough_id, summary, turns, runs, failed_attempts)
