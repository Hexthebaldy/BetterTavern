"""vis 用的数据库查询：只读，跨所有用户（这是本机的调试工具）。

故事文本（叙述、玩家写的行动、选项文字）默认不取出来：story=False 时只给长度。
用户只以代号出现（用户 id 的哈希，和日志里的 user_ref 一样），不给邮箱。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.observability.context import user_ref


def _ms(value: datetime | None) -> float | None:
    return value.timestamp() * 1000 if value is not None else None


async def list_playthroughs(conn: AsyncConnection, limit: int = 200) -> list[dict[str, Any]]:
    rows = await conn.execute(
        text(
            """
            SELECT p.id::text AS id, p.user_id::text AS user_id, p.title, p.status, p.seed_source,
                   p.created_at, p.updated_at, p.active_turn_id::text AS active_turn_id,
                   s.name AS scenario_name,
                   count(t.id) FILTER (WHERE t.status NOT IN ('failed', 'archived')) AS turns,
                   count(t.id) FILTER (WHERE t.status = 'failed') AS failed,
                   max(t.created_at) AS last_turn_at
            FROM playthroughs p
            LEFT JOIN scenarios s ON s.id = p.scenario_id
            LEFT JOIN turns t ON t.playthrough_id = p.id
            GROUP BY p.id, s.name
            ORDER BY p.updated_at DESC
            LIMIT :limit
            """
        ),
        {"limit": limit},
    )
    return [
        {
            "id": r.id,
            "user_ref": user_ref(r.user_id),
            "title": r.title,
            "status": r.status,
            "seed_source": r.seed_source,
            "scenario_name": r.scenario_name,
            "turns": r.turns,
            "failed": r.failed,
            "generating": r.active_turn_id is not None,
            "created_at": _ms(r.created_at),
            "updated_at": _ms(r.updated_at),
            "last_turn_at": _ms(r.last_turn_at),
        }
        for r in rows
    ]


_TURN_COLUMNS = """
    t.id::text AS id, t.playthrough_id::text AS playthrough_id, t.seq, t.attempt, t.status,
    t.user_action, t.narrative, t.options, t.options_source, t.state_lag, t.usage, t.error,
    t.created_at, t.replied_at, t.committed_at,
    r.provider, r.model, r.ttft_ms, r.latency_ms, r.input_tokens, r.cached_tokens,
    r.output_tokens, r.reasoning_tokens, r.status AS run_status, r.error_class AS run_error_class
"""

_DIRECTOR_RUN = """
    LEFT JOIN LATERAL (
        SELECT * FROM agent_runs a
        WHERE a.turn_id = t.id AND a.agent = 'director'
        ORDER BY a.created_at DESC LIMIT 1
    ) r ON true
"""


def _turn(row: Any, *, story: bool) -> dict[str, Any]:
    action = row.user_action or {}
    action_text = action.get("text") or ""
    options = row.options or []
    out: dict[str, Any] = {
        "id": row.id,
        "playthrough_id": row.playthrough_id,
        "seq": row.seq,
        "attempt": row.attempt,
        "status": row.status,
        "action": {
            "source": action.get("source"),
            "option_id": action.get("option_id"),
            "text_chars": len(action_text),
        },
        "narrative_chars": len(row.narrative or ""),
        "options_count": len(options),
        "options_source": row.options_source,
        "state_lag": row.state_lag,
        "usage": row.usage,
        "error": row.error,
        "created_at": _ms(row.created_at),
        "replied_at": _ms(row.replied_at),
        "duration_ms": (
            (row.replied_at - row.created_at).total_seconds() * 1000 if row.replied_at else None
        ),
        "run": {
            "provider": row.provider,
            "model": row.model,
            "ttft_ms": row.ttft_ms,
            "latency_ms": row.latency_ms,
            "input_tokens": row.input_tokens,
            "cached_tokens": row.cached_tokens,
            "output_tokens": row.output_tokens,
            "reasoning_tokens": row.reasoning_tokens,
            "status": row.run_status,
            "error_class": row.run_error_class,
        }
        if row.model is not None
        else None,
    }
    if story:
        out["action"]["text"] = action_text
        out["narrative"] = row.narrative
        out["options"] = [o.get("text") for o in options if isinstance(o, dict)]
    return out


async def playthrough_detail(
    conn: AsyncConnection, playthrough_id: str, *, story: bool = False
) -> dict[str, Any] | None:
    pt = (
        await conn.execute(
            text(
                """
                SELECT p.id::text AS id, p.user_id::text AS user_id, p.title, p.status,
                       p.seed_source, p.head_turn_id::text AS head_turn_id,
                       p.active_turn_id::text AS active_turn_id, p.lease_owner,
                       p.created_at, p.updated_at, s.name AS scenario_name
                FROM playthroughs p LEFT JOIN scenarios s ON s.id = p.scenario_id
                WHERE p.id = CAST(:id AS uuid)
                """
            ),
            {"id": playthrough_id},
        )
    ).one_or_none()
    if pt is None:
        return None
    turns = await conn.execute(
        text(
            f"SELECT {_TURN_COLUMNS} FROM turns t {_DIRECTOR_RUN} "
            "WHERE t.playthrough_id = CAST(:id AS uuid) ORDER BY t.seq, t.attempt, t.created_at"
        ),
        {"id": playthrough_id},
    )
    return {
        "playthrough": {
            "id": pt.id,
            "user_ref": user_ref(pt.user_id),
            "title": pt.title,
            "status": pt.status,
            "seed_source": pt.seed_source,
            "scenario_name": pt.scenario_name,
            "head_turn_id": pt.head_turn_id,
            "active_turn_id": pt.active_turn_id,
            "lease_owner": pt.lease_owner,
            "created_at": _ms(pt.created_at),
            "updated_at": _ms(pt.updated_at),
        },
        "turns": [_turn(r, story=story) for r in turns],
    }


def _step(row: Any, *, story: bool) -> dict[str, Any]:
    """agent 运行里的一步。不显示故事时去掉模型写的原文（只给长度）和工具参数的值。"""
    args = dict(row.args or {})
    result = dict(row.result or {})
    if not story:
        text_value = result.pop("text", None)
        if isinstance(text_value, str):
            result["text_chars"] = len(text_value)
        if row.kind == "tool":
            # 工具参数是模型从故事里取的词，只留参数名
            args = dict.fromkeys(args)
    return {
        "step": row.step,
        "kind": row.kind,
        "tool": row.tool,
        "args": args,
        "result": result,
        "latency_ms": row.latency_ms,
        "input_tokens": row.input_tokens,
        "cached_tokens": row.cached_tokens,
        "output_tokens": row.output_tokens,
    }


async def turn_detail(
    conn: AsyncConnection, turn_id: str, *, story: bool = False
) -> dict[str, Any] | None:
    row = (
        await conn.execute(
            text(
                f"""
                SELECT {_TURN_COLUMNS}, p.title AS playthrough_title, p.user_id::text AS user_id
                FROM turns t JOIN playthroughs p ON p.id = t.playthrough_id {_DIRECTOR_RUN}
                WHERE t.id = CAST(:id AS uuid)
                """
            ),
            {"id": turn_id},
        )
    ).one_or_none()
    if row is None:
        return None
    turn = _turn(row, story=story)
    turn["playthrough_title"] = row.playthrough_title
    turn["user_ref"] = user_ref(row.user_id)
    runs = await conn.execute(
        text(
            """
            SELECT id::text AS id, agent, task, provider, model, prompt_hash, input_tokens,
                   cached_tokens, output_tokens, reasoning_tokens, ttft_ms, latency_ms, status,
                   error_class, result, created_at
            FROM agent_runs WHERE turn_id = CAST(:id AS uuid) ORDER BY created_at
            """
        ),
        {"id": turn_id},
    )
    step_rows = await conn.execute(
        text(
            """
            SELECT s.run_id::text AS run_id, s.step, s.kind, s.tool, s.args, s.result,
                   s.latency_ms, s.input_tokens, s.cached_tokens, s.output_tokens
            FROM agent_steps s JOIN agent_runs a ON a.id = s.run_id
            WHERE a.turn_id = CAST(:id AS uuid)
            ORDER BY s.run_id, s.step
            """
        ),
        {"id": turn_id},
    )
    steps: dict[str, list[dict[str, Any]]] = {}
    for s in step_rows:
        steps.setdefault(s.run_id, []).append(_step(s, story=story))
    neighbours = await conn.execute(
        text(
            """
            SELECT id::text AS id, seq, attempt, status FROM turns
            WHERE playthrough_id = CAST(:pt AS uuid) AND seq BETWEEN :seq - 1 AND :seq + 1
            ORDER BY seq, attempt
            """
        ),
        {"pt": row.playthrough_id, "seq": row.seq},
    )
    return {
        "turn": turn,
        "runs": [
            {
                "id": r.id,
                "agent": r.agent,
                "task": r.task,
                "provider": r.provider,
                "model": r.model,
                "prompt_hash": r.prompt_hash,
                "input_tokens": r.input_tokens,
                "cached_tokens": r.cached_tokens,
                "output_tokens": r.output_tokens,
                "reasoning_tokens": r.reasoning_tokens,
                "ttft_ms": r.ttft_ms,
                "latency_ms": r.latency_ms,
                "status": r.status,
                "error_class": r.error_class,
                "result": r.result,
                "created_at": _ms(r.created_at),
                "steps": steps.get(r.id, []),
            }
            for r in runs
        ],
        "neighbours": [
            {"id": n.id, "seq": n.seq, "attempt": n.attempt, "status": n.status} for n in neighbours
        ],
    }


async def overview(conn: AsyncConnection, hours: int) -> dict[str, Any]:
    window = {"hours": hours}
    turns = (
        await conn.execute(
            text(
                """
                SELECT count(*) FILTER (WHERE status IN ('committed', 'replied')) AS ok,
                       count(*) FILTER (WHERE status = 'failed') AS failed,
                       count(*) FILTER (WHERE status = 'generating') AS generating
                FROM turns WHERE created_at > now() - make_interval(hours => :hours)
                """
            ),
            window,
        )
    ).one()
    runs = (
        await conn.execute(
            text(
                """
                SELECT count(*) AS calls,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft_ms) AS ttft_p50,
                       percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft_ms) AS ttft_p95,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS latency_p50,
                       coalesce(sum(input_tokens), 0) AS input_tokens,
                       coalesce(sum(cached_tokens), 0) AS cached_tokens,
                       coalesce(sum(output_tokens), 0) AS output_tokens,
                       coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens
                FROM agent_runs
                WHERE agent = 'director' AND status = 'ok'
                  AND created_at > now() - make_interval(hours => :hours)
                """
            ),
            window,
        )
    ).one()
    hourly = await conn.execute(
        text(
            """
            SELECT date_trunc('hour', created_at) AS hour,
                   count(*) FILTER (WHERE status IN ('committed', 'replied')) AS ok,
                   count(*) FILTER (WHERE status = 'failed') AS failed
            FROM turns WHERE created_at > now() - make_interval(hours => :hours)
            GROUP BY 1 ORDER BY 1
            """
        ),
        window,
    )
    failures = await conn.execute(
        text(
            """
            SELECT t.id::text AS id, t.seq, t.playthrough_id::text AS playthrough_id, t.error,
                   t.created_at, p.title
            FROM turns t JOIN playthroughs p ON p.id = t.playthrough_id
            WHERE t.status = 'failed' AND t.created_at > now() - make_interval(hours => :hours)
            ORDER BY t.created_at DESC LIMIT 20
            """
        ),
        window,
    )
    return {
        "turns": {"ok": turns.ok, "failed": turns.failed, "generating": turns.generating},
        "director": {
            "calls": runs.calls,
            "ttft_p50": runs.ttft_p50,
            "ttft_p95": runs.ttft_p95,
            "latency_p50": runs.latency_p50,
            "input_tokens": runs.input_tokens,
            "cached_tokens": runs.cached_tokens,
            "output_tokens": runs.output_tokens,
            "reasoning_tokens": runs.reasoning_tokens,
        },
        "hourly": [{"hour": _ms(h.hour), "ok": h.ok, "failed": h.failed} for h in hourly],
        "failed_turns": [
            {
                "id": f.id,
                "seq": f.seq,
                "playthrough_id": f.playthrough_id,
                "title": f.title,
                "code": (f.error or {}).get("code"),
                "message": (f.error or {}).get("message"),
                "created_at": _ms(f.created_at),
            }
            for f in failures
        ],
    }


async def find_ids(conn: AsyncConnection, prefix: str, limit: int = 10) -> list[dict[str, Any]]:
    """按编号（或编号开头）找回合和故事"""
    pattern = prefix.lower() + "%"
    turns = await conn.execute(
        text(
            """
            SELECT t.id::text AS id, t.seq, p.title
            FROM turns t JOIN playthroughs p ON p.id = t.playthrough_id
            WHERE t.id::text LIKE :p ORDER BY t.created_at DESC LIMIT :limit
            """
        ),
        {"p": pattern, "limit": limit},
    )
    pts = await conn.execute(
        text("SELECT id::text AS id, title FROM playthroughs WHERE id::text LIKE :p LIMIT :limit"),
        {"p": pattern, "limit": limit},
    )
    return [{"kind": "turn", "id": t.id, "seq": t.seq, "title": t.title} for t in turns] + [
        {"kind": "playthrough", "id": p.id, "title": p.title} for p in pts
    ]
