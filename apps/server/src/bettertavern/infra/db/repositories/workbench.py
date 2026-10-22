"""工作台 agent 的读写：对话记录（workbench_messages）、推送事件（workbench_events）、
一轮 agent 的开始、心跳、写卡和结束（workbench_drafts 上带 run_id 的条件更新）。

worker 里的 agent 每次写草稿都带着 run_id：草稿已经不是这一轮在跑（被接管、草稿删了）就不写。
推送事件写进表以后发 NOTIFY（频道 bt_workbench，内容是草稿 id），
api 进程收到后去读新事件推给客户端。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import (
    Row,
    as_json,
    dumps,
    execute,
    fetch_all,
    fetch_one,
    opt_str,
)

NOTIFY_CHANNEL = "bt_workbench"
# 心跳超过这么久没更新，就当这一轮已经死了（worker 意外退出），可以重新开一轮
STALE_RUN_S = 300
# api 发的事件（采用改动等）不属于哪一轮 agent，run_id 记成全零
API_RUN_ID = "00000000-0000-0000-0000-000000000000"


@dataclass(frozen=True, slots=True)
class MessageRow:
    seq: int
    role: str
    kind: str
    content: dict[str, Any]
    run_id: str | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: Row) -> MessageRow:
        return cls(
            seq=row["seq"],
            role=row["role"],
            kind=row["kind"],
            content=as_json(row["content"], {}) or {},
            run_id=opt_str(row["run_id"]),
            created_at=row["created_at"],
        )


@dataclass(frozen=True, slots=True)
class EventRow:
    id: int
    type: str
    data: dict[str, Any]


# ---- 对话记录 ------------------------------------------------------------------------------


async def insert_message(
    conn: AsyncConnection,
    draft_id: str,
    *,
    role: str,
    kind: str,
    content: Mapping[str, Any],
    run_id: str | None = None,
) -> MessageRow:
    """序号从草稿的 last_seq 取（行锁保证同一份草稿的序号不重复）。"""
    row = await fetch_one(
        conn,
        """UPDATE workbench_drafts SET last_seq = last_seq + 1, updated_at = now()
           WHERE id = :d RETURNING last_seq""",
        {"d": draft_id},
    )
    assert row is not None
    seq = int(row["last_seq"])
    inserted = await fetch_one(
        conn,
        """INSERT INTO workbench_messages (draft_id, seq, role, kind, content, run_id)
           VALUES (:d, :s, :role, :kind, CAST(:c AS jsonb), :run)
           RETURNING seq, role, kind, content, run_id, created_at""",
        {"d": draft_id, "s": seq, "role": role, "kind": kind, "c": dumps(content), "run": run_id},
    )
    assert inserted is not None
    return MessageRow.from_row(inserted)


async def list_messages(conn: AsyncConnection, draft_id: str) -> list[MessageRow]:
    rows = await fetch_all(
        conn,
        """SELECT seq, role, kind, content, run_id, created_at FROM workbench_messages
           WHERE draft_id = :d ORDER BY seq""",
        {"d": draft_id},
    )
    return [MessageRow.from_row(r) for r in rows]


async def get_message(conn: AsyncConnection, draft_id: str, seq: int) -> MessageRow | None:
    row = await fetch_one(
        conn,
        """SELECT seq, role, kind, content, run_id, created_at FROM workbench_messages
           WHERE draft_id = :d AND seq = :s""",
        {"d": draft_id, "s": seq},
    )
    return None if row is None else MessageRow.from_row(row)


async def update_message(
    conn: AsyncConnection, draft_id: str, seq: int, content: Mapping[str, Any]
) -> None:
    await execute(
        conn,
        """UPDATE workbench_messages SET content = CAST(:c AS jsonb)
           WHERE draft_id = :d AND seq = :s""",
        {"d": draft_id, "s": seq, "c": dumps(content)},
    )


# ---- 推送事件 ------------------------------------------------------------------------------


async def insert_events(
    conn: AsyncConnection,
    draft_id: str,
    run_id: str,
    events: Sequence[tuple[str, Mapping[str, Any]]],
) -> None:
    for kind, data in events:
        await execute(
            conn,
            """INSERT INTO workbench_events (draft_id, run_id, type, data)
               VALUES (:d, :r, :t, CAST(:data AS jsonb))""",
            {"d": draft_id, "r": run_id, "t": kind, "data": dumps(data)},
        )
    if events:
        await execute(conn, "SELECT pg_notify(:ch, :d)", {"ch": NOTIFY_CHANNEL, "d": draft_id})


async def events_after(
    conn: AsyncConnection, draft_id: str, after_id: int, *, limit: int = 500
) -> list[EventRow]:
    rows = await fetch_all(
        conn,
        """SELECT id, type, data FROM workbench_events
           WHERE draft_id = :d AND id > :a ORDER BY id LIMIT :n""",
        {"d": draft_id, "a": after_id, "n": limit},
    )
    return [
        EventRow(id=int(r["id"]), type=r["type"], data=as_json(r["data"], {}) or {}) for r in rows
    ]


async def last_event_id(conn: AsyncConnection, draft_id: str) -> int:
    row = await fetch_one(
        conn,
        "SELECT COALESCE(max(id), 0) AS id FROM workbench_events WHERE draft_id = :d",
        {"d": draft_id},
    )
    return int(row["id"]) if row is not None else 0


async def delete_old_events(conn: AsyncConnection, *, older_than_s: int) -> int:
    """一天以前的事件：内容早已存进对话记录和草稿，事件只是路上用的。"""
    return await execute(
        conn,
        "DELETE FROM workbench_events WHERE created_at < now() - make_interval(secs => :s)",
        {"s": older_than_s},
    )


# ---- 一轮 agent ----------------------------------------------------------------------------


async def start_run(
    conn: AsyncConnection,
    user_id: str,
    draft_id: str,
    run_id: str,
    *,
    stage: str | None = None,
    plan_approved_seq: int | None = None,
) -> bool:
    """把草稿改成 running（带条件：现在没有一轮在跑，或者在跑的那一轮心跳已经过期）。
    改不动返回 False。"""
    count = await execute(
        conn,
        """UPDATE workbench_drafts
           SET agent_status = 'running', run_id = :r, run_heartbeat_at = now(),
               stop_requested = false, awaiting = NULL, mode = 'agent',
               stage = COALESCE(:stage, stage),
               plan_approved_seq = COALESCE(CAST(:plan AS integer), plan_approved_seq),
               updated_at = now()
           WHERE id = :d AND user_id = :u
             AND (agent_status <> 'running'
                  OR run_heartbeat_at < now() - make_interval(secs => :stale))""",
        {
            "d": draft_id,
            "u": user_id,
            "r": run_id,
            "stage": stage,
            "plan": plan_approved_seq,
            "stale": STALE_RUN_S,
        },
    )
    return count > 0


async def heartbeat(conn: AsyncConnection, draft_id: str, run_id: str) -> bool | None:
    """报平安，返回 stop_requested；草稿已经不是这一轮在跑时返回 None。"""
    row = await fetch_one(
        conn,
        """UPDATE workbench_drafts SET run_heartbeat_at = now()
           WHERE id = :d AND run_id = :r AND agent_status = 'running'
           RETURNING stop_requested""",
        {"d": draft_id, "r": run_id},
    )
    return None if row is None else bool(row["stop_requested"])


async def write_card(
    conn: AsyncConnection,
    draft_id: str,
    run_id: str,
    *,
    expected_version: int,
    name: str,
    card: Mapping[str, Any],
) -> int | None:
    row = await fetch_one(
        conn,
        """UPDATE workbench_drafts
           SET card = CAST(:c AS jsonb), name = :name, version = version + 1, updated_at = now(),
               run_heartbeat_at = now()
           WHERE id = :d AND run_id = :r AND agent_status = 'running' AND version = :v
           RETURNING version""",
        {"d": draft_id, "r": run_id, "v": expected_version, "name": name, "c": dumps(card)},
    )
    return None if row is None else int(row["version"])


async def set_run_fields(conn: AsyncConnection, draft_id: str, run_id: str, **fields: Any) -> bool:
    """这一轮在跑时改几列（todos、stage）。"""
    sets = []
    params: dict[str, Any] = {"d": draft_id, "r": run_id}
    if "todos" in fields:
        sets.append("todos = CAST(:todos AS jsonb)")
        params["todos"] = dumps(fields["todos"])
    if "stage" in fields:
        sets.append("stage = :stage")
        params["stage"] = fields["stage"]
    if not sets:
        return False
    count = await execute(
        conn,
        f"""UPDATE workbench_drafts SET {", ".join(sets)}, run_heartbeat_at = now()
            WHERE id = :d AND run_id = :r AND agent_status = 'running'""",
        params,
    )
    return count > 0


async def set_run_cover(
    conn: AsyncConnection, draft_id: str, run_id: str, asset_id: str | None
) -> int | None:
    row = await fetch_one(
        conn,
        """UPDATE workbench_drafts
           SET cover_asset_id = :a, version = version + 1, updated_at = now()
           WHERE id = :d AND run_id = :r AND agent_status = 'running'
           RETURNING version""",
        {"d": draft_id, "r": run_id, "a": asset_id},
    )
    return None if row is None else int(row["version"])


async def finish_run(
    conn: AsyncConnection,
    draft_id: str,
    run_id: str,
    *,
    stage: str,
    agent_status: str,
    awaiting: Mapping[str, Any] | None,
    baseline: Mapping[str, Any],
) -> bool:
    count = await execute(
        conn,
        """UPDATE workbench_drafts
           SET agent_status = :s, awaiting = CAST(:a AS jsonb), stage = :stage,
               agent_baseline = CAST(:b AS jsonb), stop_requested = false, run_id = NULL,
               run_heartbeat_at = NULL, updated_at = now()
           WHERE id = :d AND run_id = :r""",
        {
            "d": draft_id,
            "r": run_id,
            "s": agent_status,
            "a": None if awaiting is None else dumps(awaiting),
            "stage": stage,
            "b": dumps(baseline),
        },
    )
    return count > 0


async def run_owner(conn: AsyncConnection, draft_id: str, run_id: str) -> str | None:
    """这一轮属于哪个用户；草稿已经不是这一轮在跑时返回 None。"""
    row = await fetch_one(
        conn,
        "SELECT user_id FROM workbench_drafts WHERE id = :d AND run_id = :r",
        {"d": draft_id, "r": run_id},
    )
    return None if row is None else str(row["user_id"])


async def clear_awaiting(conn: AsyncConnection, draft_id: str) -> None:
    await execute(
        conn,
        """UPDATE workbench_drafts SET agent_status = 'idle', awaiting = NULL, updated_at = now()
           WHERE id = :d AND agent_status = 'awaiting_user'""",
        {"d": draft_id},
    )


async def draft_basics(conn: AsyncConnection, draft_id: str) -> dict[str, Any] | None:
    """worker 用：草稿的用户、版本号、显示名和卡片（不按用户过滤，调用方已经用 run_id 确认过）。"""
    row = await fetch_one(
        conn,
        "SELECT user_id, version, name, card FROM workbench_drafts WHERE id = :d",
        {"d": draft_id},
    )
    if row is None:
        return None
    return {**row, "user_id": str(row["user_id"]), "card": as_json(row["card"], {}) or {}}


async def run_trigger(conn: AsyncConnection, run_id: str) -> str | None:
    """这一轮是什么触发的（放任务时写在 payload 里）。"""
    row = await fetch_one(
        conn,
        """SELECT payload->>'trigger' AS trigger FROM jobs
           WHERE kind = 'workbench.run' AND payload->>'run_id' = :r
           ORDER BY id DESC LIMIT 1""",
        {"r": run_id},
    )
    return None if row is None else row["trigger"]
