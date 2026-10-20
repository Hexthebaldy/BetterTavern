"""agent_runs 账本：审计、幂等与用量统计。result 里不放故事全文。

agent_steps：一次运行里的每一步（调模型、用工具），参数和结果里有故事文字，只存数据库、不写日志。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import dumps, execute, fetch_one


@dataclass(frozen=True, slots=True)
class AgentRunInsert:
    user_id: str
    agent: str
    task: str
    status: str
    playthrough_id: str | None = None
    turn_id: str | None = None
    provider: str | None = None
    model: str | None = None
    prompt_hash: str | None = None
    input_tokens: int | None = None
    cached_tokens: int | None = None
    output_tokens: int | None = None
    reasoning_tokens: int | None = None
    ttft_ms: int | None = None
    latency_ms: int | None = None
    error_class: str | None = None
    result: dict[str, Any] = field(default_factory=dict)


async def insert_agent_run(conn: AsyncConnection, run: AgentRunInsert) -> str:
    row = await fetch_one(
        conn,
        """
        INSERT INTO agent_runs (user_id, playthrough_id, turn_id, agent, task, provider, model,
                                prompt_hash, input_tokens, cached_tokens, output_tokens,
                                reasoning_tokens, ttft_ms, latency_ms, status, error_class, result)
        VALUES (:user_id, :playthrough_id, :turn_id, :agent, :task, :provider, :model,
                :prompt_hash, :input_tokens, :cached_tokens, :output_tokens, :reasoning_tokens,
                :ttft_ms, :latency_ms, :status, :error_class, CAST(:result AS jsonb))
        RETURNING id
        """,
        {
            "user_id": run.user_id,
            "playthrough_id": run.playthrough_id,
            "turn_id": run.turn_id,
            "agent": run.agent,
            "task": run.task,
            "provider": run.provider,
            "model": run.model,
            "prompt_hash": run.prompt_hash,
            "input_tokens": run.input_tokens,
            "cached_tokens": run.cached_tokens,
            "output_tokens": run.output_tokens,
            "reasoning_tokens": run.reasoning_tokens,
            "ttft_ms": run.ttft_ms,
            "latency_ms": run.latency_ms,
            "status": run.status,
            "error_class": run.error_class,
            "result": dumps(run.result),
        },
    )
    assert row is not None
    return str(row["id"])


@dataclass(frozen=True, slots=True)
class AgentStepInsert:
    kind: Literal["model", "tool"]
    tool: str | None
    args: dict[str, Any]
    result: dict[str, Any]
    latency_ms: int | None = None
    input_tokens: int | None = None
    cached_tokens: int | None = None
    output_tokens: int | None = None


async def insert_agent_steps(
    conn: AsyncConnection, run_id: str, steps: Sequence[AgentStepInsert]
) -> None:
    """按顺序写入，step 从 0 开始。一次运行通常只有一到几步，逐条插入就够了。"""
    for index, step in enumerate(steps):
        await execute(
            conn,
            """
            INSERT INTO agent_steps (run_id, step, kind, tool, args, result, latency_ms,
                                     input_tokens, cached_tokens, output_tokens)
            VALUES (:run, :step, :kind, :tool, CAST(:args AS jsonb), CAST(:result AS jsonb),
                    :latency, :input, :cached, :output)
            """,
            {
                "run": run_id,
                "step": index,
                "kind": step.kind,
                "tool": step.tool,
                "args": dumps(step.args),
                "result": dumps(step.result),
                "latency": step.latency_ms,
                "input": step.input_tokens,
                "cached": step.cached_tokens,
                "output": step.output_tokens,
            },
        )
