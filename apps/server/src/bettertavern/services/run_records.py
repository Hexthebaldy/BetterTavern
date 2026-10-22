"""把一次 agent 运行（AgentRunRecord）写进 agent_runs，连同它的每一步（agent_steps）。

前台的回合（turn_store.py）、后台的世界状态整理（state_store.py）
和工作台的 agent（workbench_store.py）都用它。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.repositories import runs as runs_repo
from bettertavern.runtime.agent import AgentStep
from bettertavern.runtime.ports import AgentRunRecord


def run_insert(
    run: AgentRunRecord,
    *,
    user_id: str,
    playthrough_id: str | None,
    turn_id: str | None,
    draft_id: str | None = None,
    run_id: str | None = None,
) -> runs_repo.AgentRunInsert:
    usage = run.usage
    return runs_repo.AgentRunInsert(
        user_id=user_id,
        playthrough_id=playthrough_id,
        turn_id=turn_id,
        agent=run.agent,
        task=run.task,
        status=run.status,
        provider=run.provider,
        model=run.model,
        prompt_hash=run.prompt_hash,
        input_tokens=usage.prompt if usage else None,
        cached_tokens=usage.cached if usage else None,
        output_tokens=usage.completion if usage else None,
        reasoning_tokens=usage.reasoning if usage else None,
        ttft_ms=run.ttft_ms,
        latency_ms=run.latency_ms,
        error_class=run.error_class,
        result=dict(run.result),
        draft_id=draft_id,
        id=run_id,
    )


def step_insert(step: AgentStep) -> runs_repo.AgentStepInsert:
    usage = step.usage
    return runs_repo.AgentStepInsert(
        kind=step.kind,
        tool=step.tool,
        args=dict(step.args),
        result=dict(step.result),
        latency_ms=step.latency_ms,
        input_tokens=usage.prompt if usage else None,
        cached_tokens=usage.cached if usage else None,
        output_tokens=usage.completion if usage else None,
    )


async def insert_run(
    conn: AsyncConnection,
    run: AgentRunRecord,
    *,
    user_id: str,
    playthrough_id: str | None,
    turn_id: str | None,
    draft_id: str | None = None,
    run_id: str | None = None,
) -> str:
    """写一行 agent_runs，连同它的每一步。返回这次运行的 id（给了 run_id 就用它）。"""
    run_id = await runs_repo.insert_agent_run(
        conn,
        run_insert(
            run,
            user_id=user_id,
            playthrough_id=playthrough_id,
            turn_id=turn_id,
            draft_id=draft_id,
            run_id=run_id,
        ),
    )
    await runs_repo.insert_agent_steps(conn, run_id, [step_insert(s) for s in run.steps])
    return run_id
