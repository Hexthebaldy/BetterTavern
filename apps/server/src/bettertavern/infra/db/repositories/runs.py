"""agent_runs 账本：审计、幂等与用量统计。result 里不放故事全文。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import dumps, fetch_one


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
