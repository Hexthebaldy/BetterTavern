"""把一次 agent 运行（AgentRunRecord）写进 agent_runs，连同它的每一步（agent_steps）。

前台的回合（turn_store.py）、后台的世界状态整理（state_store.py）
和工作台的 agent（workbench_store.py）都用它。

用的是官方模型（run.prices 不为空）时，在同一个事务里按这次的用量扣用户的点数（credit_ledger）：
用量取每一步调模型的用量之和（一次运行可能调好几次模型），没有分步记录时用整次的用量。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.repositories import credits as credits_repo
from bettertavern.infra.db.repositories import runs as runs_repo
from bettertavern.providers import Usage
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
    await charge_run(conn, run, user_id=user_id, run_id=run_id)
    return run_id


def billed_usage(run: AgentRunRecord) -> Usage | None:
    """要计费的用量：每一步调模型的用量之和；没有分步记录时用整次的用量。"""
    usages = [s.usage for s in run.steps if s.usage is not None]
    if not usages:
        return run.usage
    return Usage(
        prompt=sum(u.prompt for u in usages),
        completion=sum(u.completion for u in usages),
        cached=sum(u.cached for u in usages),
        reasoning=sum(u.reasoning for u in usages),
    )


async def charge_run(
    conn: AsyncConnection, run: AgentRunRecord, *, user_id: str, run_id: str
) -> None:
    """官方模型：按这次运行的用量扣点数。用户自己的 Key 不扣。"""
    if run.prices is None:
        return
    usage = billed_usage(run)
    if usage is None:
        return
    cost = run.prices.cost_micro(
        prompt=usage.prompt, cached=usage.cached, completion=usage.completion
    )
    if cost <= 0:
        return
    await credits_repo.add(
        conn,
        user_id,
        credits_repo.LedgerEntry(
            kind="charge",
            amount_micro=-cost,
            run_id=run_id,
            agent=run.agent,
            model=run.model,
            input_tokens=usage.prompt,
            cached_tokens=usage.cached,
            output_tokens=usage.completion,
        ),
    )
