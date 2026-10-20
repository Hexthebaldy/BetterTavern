"""playthroughs、turns 与 idempotency_keys。

版本围栏：所有改变时间线的写入都先对 playthroughs 做带条件的 UPDATE（或 SELECT ... FOR UPDATE），
影响行数为 0 就说明期间发生了回退、租约丢失或另一次提交，整体放弃。
"""

from __future__ import annotations

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
    fetch_value,
    opt_str,
)

TURN_NOTIFY_CHANNEL = "bt_turns"


@dataclass(frozen=True, slots=True)
class PlaythroughRow:
    id: str
    user_id: str
    scenario_id: str | None
    title: str
    status: str
    language: str
    settings: dict[str, Any]
    seed: dict[str, Any] | None
    seed_source: str | None
    head_turn_id: str | None
    timeline_epoch: int
    state_seq: int  # 世界状态已整理到第几回合，-1 表示还没整理过
    rollback_floor_seq: int
    active_turn_id: str | None
    lease_expires_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: Row) -> PlaythroughRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            scenario_id=opt_str(row["scenario_id"]),
            title=row["title"],
            status=row["status"],
            language=row["language"],
            settings=as_json(row["settings"], {}),
            seed=as_json(row["seed"]),
            seed_source=row["seed_source"],
            head_turn_id=opt_str(row["head_turn_id"]),
            timeline_epoch=int(row["timeline_epoch"]),
            state_seq=int(row["state_seq"]),
            rollback_floor_seq=int(row["rollback_floor_seq"]),
            active_turn_id=opt_str(row["active_turn_id"]),
            lease_expires_at=row["lease_expires_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


_PT_COLS = """id, user_id, scenario_id, title, status, language, settings, seed, seed_source,
    head_turn_id, timeline_epoch, state_seq, rollback_floor_seq, active_turn_id,
    lease_expires_at, created_at, updated_at"""


async def insert_playthrough(
    conn: AsyncConnection,
    *,
    user_id: str,
    scenario_id: str | None,
    title: str,
    language: str,
    settings: dict[str, Any],
) -> PlaythroughRow:
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO playthroughs (user_id, scenario_id, title, language, settings)
        VALUES (:u, :scenario, :title, :lang, CAST(:settings AS jsonb))
        RETURNING {_PT_COLS}
        """,
        {
            "u": user_id,
            "scenario": scenario_id,
            "title": title,
            "lang": language,
            "settings": dumps(settings),
        },
    )
    assert row is not None
    return PlaythroughRow.from_row(row)


async def get_playthrough(
    conn: AsyncConnection, user_id: str, playthrough_id: str, *, lock: bool = False
) -> PlaythroughRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_PT_COLS} FROM playthroughs WHERE id = :id AND user_id = :u"
        + (" FOR UPDATE" if lock else ""),
        {"id": playthrough_id, "u": user_id},
    )
    return None if row is None else PlaythroughRow.from_row(row)


async def get_playthrough_by_id(
    conn: AsyncConnection, playthrough_id: str, *, lock: bool = False
) -> PlaythroughRow | None:
    """内部使用（runner、清理任务）：不带 user_id 条件。"""
    row = await fetch_one(
        conn,
        f"SELECT {_PT_COLS} FROM playthroughs WHERE id = :id" + (" FOR UPDATE" if lock else ""),
        {"id": playthrough_id},
    )
    return None if row is None else PlaythroughRow.from_row(row)


async def list_playthroughs(conn: AsyncConnection, user_id: str, limit: int = 100) -> list[Row]:
    """列表页：带上头部回合的 seq 与叙述开头，避免逐个再查。"""
    return await fetch_all(
        conn,
        f"""
        SELECT {", ".join("p." + c.strip() for c in _PT_COLS.split(","))},
               h.seq AS head_seq, left(h.narrative, 120) AS head_excerpt
        FROM playthroughs AS p
        LEFT JOIN turns AS h ON h.id = p.head_turn_id
        WHERE p.user_id = :u
        ORDER BY p.updated_at DESC
        LIMIT :limit
        """,
        {"u": user_id, "limit": limit},
    )


async def rename_playthrough(
    conn: AsyncConnection, user_id: str, playthrough_id: str, title: str
) -> PlaythroughRow | None:
    row = await fetch_one(
        conn,
        f"""UPDATE playthroughs SET title = :title, updated_at = now()
            WHERE id = :id AND user_id = :u RETURNING {_PT_COLS}""",
        {"id": playthrough_id, "u": user_id, "title": title},
    )
    return None if row is None else PlaythroughRow.from_row(row)


async def delete_playthrough(conn: AsyncConnection, user_id: str, playthrough_id: str) -> bool:
    count = await execute(
        conn,
        "DELETE FROM playthroughs WHERE id = :id AND user_id = :u",
        {"id": playthrough_id, "u": user_id},
    )
    return count == 1


async def take_lease(
    conn: AsyncConnection, playthrough_id: str, turn_id: str, *, ttl_s: float, owner: str
) -> None:
    """调用方已经锁了 playthroughs 行并确认没有未过期的租约。"""
    await execute(
        conn,
        """
        UPDATE playthroughs
        SET active_turn_id = :turn, lease_expires_at = now() + make_interval(secs => :ttl),
            lease_owner = :owner, updated_at = now()
        WHERE id = :id
        """,
        {"id": playthrough_id, "turn": turn_id, "ttl": float(ttl_s), "owner": owner},
    )


async def lease_alive(conn: AsyncConnection, playthrough_id: str) -> bool:
    value = await fetch_value(
        conn,
        """SELECT active_turn_id IS NOT NULL AND lease_expires_at > now()
           FROM playthroughs WHERE id = :id""",
        {"id": playthrough_id},
    )
    return bool(value)


async def renew_lease(
    conn: AsyncConnection, playthrough_id: str, turn_id: str, *, epoch: int, ttl_s: float
) -> bool:
    count = await execute(
        conn,
        """
        UPDATE playthroughs SET lease_expires_at = now() + make_interval(secs => :ttl)
        WHERE id = :id AND active_turn_id = :turn AND timeline_epoch = :epoch
        """,
        {"id": playthrough_id, "turn": turn_id, "epoch": epoch, "ttl": float(ttl_s)},
    )
    return count == 1


async def release_lease_and_advance_head(
    conn: AsyncConnection, playthrough_id: str, turn_id: str, *, epoch: int, end: bool = False
) -> bool:
    """回合成功：头部指向它并清除租约；end 为真（写完了结局）时同时把这局标为 ended。
    条件不满足（租约已丢、发生了回退）返回 False。"""
    count = await execute(
        conn,
        """
        UPDATE playthroughs
        SET head_turn_id = :turn, active_turn_id = NULL, lease_expires_at = NULL,
            lease_owner = NULL, updated_at = now(),
            status = CASE WHEN :end THEN 'ended' ELSE status END
        WHERE id = :id AND active_turn_id = :turn AND timeline_epoch = :epoch
        """,
        {"id": playthrough_id, "turn": turn_id, "epoch": epoch, "end": end},
    )
    return count == 1


async def release_lease(conn: AsyncConnection, playthrough_id: str, turn_id: str) -> bool:
    count = await execute(
        conn,
        """
        UPDATE playthroughs
        SET active_turn_id = NULL, lease_expires_at = NULL, lease_owner = NULL, updated_at = now()
        WHERE id = :id AND active_turn_id = :turn
        """,
        {"id": playthrough_id, "turn": turn_id},
    )
    return count == 1


async def set_world_built(
    conn: AsyncConnection,
    playthrough_id: str,
    *,
    seed: dict[str, Any],
    seed_source: str,
) -> bool:
    count = await execute(
        conn,
        """
        UPDATE playthroughs
        SET status = 'active', seed = CAST(:seed AS jsonb), seed_source = :source,
            updated_at = now()
        WHERE id = :id AND status = 'building'
        """,
        {"id": playthrough_id, "seed": dumps(seed), "source": seed_source},
    )
    return count == 1


# 租约过期的回合：清除租约并把回合标为失败（runner 所在进程崩溃或卡死）
SWEEP_EXPIRED_LEASES = """
WITH expired AS (
    SELECT id, active_turn_id FROM playthroughs
    WHERE active_turn_id IS NOT NULL AND lease_expires_at < now()
    FOR UPDATE SKIP LOCKED
), cleared AS (
    UPDATE playthroughs AS p
    SET active_turn_id = NULL, lease_expires_at = NULL, lease_owner = NULL, updated_at = now()
    FROM expired AS e
    WHERE p.id = e.id
    RETURNING e.active_turn_id AS turn_id
)
UPDATE turns AS t
SET status = 'failed', error = CAST(:error AS jsonb)
FROM cleared AS c
WHERE t.id = c.turn_id AND t.status = 'generating'
RETURNING t.id
"""

RUNNER_LOST_ERROR = {
    "code": "RUNNER_LOST",
    "message": "Generation stopped unexpectedly, please try again",
    "retryable": True,
    "partial": False,
    "reason": None,
}


async def sweep_expired_leases(conn: AsyncConnection) -> list[str]:
    rows = await fetch_all(conn, SWEEP_EXPIRED_LEASES, {"error": dumps(RUNNER_LOST_ERROR)})
    return [str(r["id"]) for r in rows]


# ---- 回合 -----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TurnRow:
    id: str
    playthrough_id: str
    seq: int
    parent_turn_id: str | None
    attempt: int
    status: str
    timeline_epoch: int
    user_action: dict[str, Any]
    narrative: str
    options: list[dict[str, Any]]
    options_source: str | None
    state_seq: int  # 写这一回合时，状态块截至第几回合
    usage: dict[str, Any] | None
    error: dict[str, Any] | None
    created_at: datetime
    replied_at: datetime | None
    committed_at: datetime | None

    @classmethod
    def from_row(cls, row: Row) -> TurnRow:
        return cls(
            id=str(row["id"]),
            playthrough_id=str(row["playthrough_id"]),
            seq=int(row["seq"]),
            parent_turn_id=opt_str(row["parent_turn_id"]),
            attempt=int(row["attempt"]),
            status=row["status"],
            timeline_epoch=int(row["timeline_epoch"]),
            user_action=as_json(row["user_action"], {}),
            narrative=row["narrative"],
            options=as_json(row["options"], []),
            options_source=row["options_source"],
            state_seq=int(row["state_seq"]),
            usage=as_json(row["usage"]),
            error=as_json(row["error"]),
            created_at=row["created_at"],
            replied_at=row["replied_at"],
            committed_at=row["committed_at"],
        )


_TURN_COLS = """id, playthrough_id, seq, parent_turn_id, attempt, status, timeline_epoch,
    user_action, narrative, options, options_source, state_seq, usage, error, created_at,
    replied_at, committed_at"""


def _prefixed(cols: str, prefix: str) -> str:
    return ", ".join(f"{prefix}.{c.strip()}" for c in cols.split(","))


async def next_attempt(conn: AsyncConnection, playthrough_id: str, seq: int) -> int:
    value = await fetch_value(
        conn,
        "SELECT COALESCE(MAX(attempt) + 1, 0) FROM turns WHERE playthrough_id = :pt AND seq = :seq",
        {"pt": playthrough_id, "seq": seq},
    )
    return int(value or 0)


async def insert_turn(
    conn: AsyncConnection,
    *,
    playthrough_id: str,
    seq: int,
    parent_turn_id: str | None,
    attempt: int,
    epoch: int,
    user_action: dict[str, Any],
) -> TurnRow:
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO turns (playthrough_id, seq, parent_turn_id, attempt, status, timeline_epoch,
                           user_action)
        VALUES (:pt, :seq, :parent, :attempt, 'generating', :epoch, CAST(:action AS jsonb))
        RETURNING {_TURN_COLS}
        """,
        {
            "pt": playthrough_id,
            "seq": seq,
            "parent": parent_turn_id,
            "attempt": attempt,
            "epoch": epoch,
            "action": dumps(user_action),
        },
    )
    assert row is not None
    return TurnRow.from_row(row)


async def get_turn(conn: AsyncConnection, turn_id: str) -> TurnRow | None:
    row = await fetch_one(conn, f"SELECT {_TURN_COLS} FROM turns WHERE id = :id", {"id": turn_id})
    return None if row is None else TurnRow.from_row(row)


async def get_user_turn(conn: AsyncConnection, user_id: str, turn_id: str) -> TurnRow | None:
    row = await fetch_one(
        conn,
        f"""
        SELECT {_prefixed(_TURN_COLS, "t")}
        FROM turns AS t JOIN playthroughs AS p ON p.id = t.playthrough_id
        WHERE t.id = :id AND p.user_id = :u
        """,
        {"id": turn_id, "u": user_id},
    )
    return None if row is None else TurnRow.from_row(row)


async def list_chain(
    conn: AsyncConnection,
    playthrough_id: str,
    *,
    after_seq: int = -1,
    up_to_seq: int | None = None,
    limit: int = 10_000,
) -> list[TurnRow]:
    """活跃链上的回合（replied / committed），按 seq 升序。"""
    rows = await fetch_all(
        conn,
        f"""
        SELECT {_TURN_COLS} FROM turns
        WHERE playthrough_id = :pt AND status IN ('replied', 'committed')
          AND seq > :after AND (CAST(:upto AS integer) IS NULL OR seq <= :upto)
        ORDER BY seq
        LIMIT :limit
        """,
        {"pt": playthrough_id, "after": after_seq, "upto": up_to_seq, "limit": limit},
    )
    return [TurnRow.from_row(r) for r in rows]


async def latest_failed_after(
    conn: AsyncConnection, playthrough_id: str, head_seq: int
) -> TurnRow | None:
    """头部之后最近一次失败的尝试（客户端据此显示“重试”）。"""
    row = await fetch_one(
        conn,
        f"""
        SELECT {_TURN_COLS} FROM turns
        WHERE playthrough_id = :pt AND status = 'failed' AND seq = :seq
        ORDER BY created_at DESC LIMIT 1
        """,
        {"pt": playthrough_id, "seq": head_seq + 1},
    )
    return None if row is None else TurnRow.from_row(row)


async def complete_turn(
    conn: AsyncConnection,
    turn_id: str,
    *,
    status: str,
    narrative: str,
    options: list[dict[str, Any]],
    options_source: str | None,
    usage: dict[str, Any] | None,
    state_seq: int,
    director_run_id: str | None,
) -> bool:
    count = await execute(
        conn,
        """
        UPDATE turns
        SET status = :status, narrative = :narrative, options = CAST(:options AS jsonb),
            options_source = :source, usage = CAST(:usage AS jsonb), state_seq = :state_seq,
            director_run_id = :run, error = NULL, replied_at = now(),
            committed_at = CASE WHEN :status = 'committed' THEN now() ELSE NULL END
        WHERE id = :id AND status = 'generating'
        """,
        {
            "id": turn_id,
            "status": status,
            "narrative": narrative,
            "options": dumps(options),
            "source": options_source,
            "usage": dumps(usage) if usage is not None else None,
            "state_seq": state_seq,
            "run": director_run_id,
        },
    )
    return count == 1


async def fail_turn(
    conn: AsyncConnection, turn_id: str, *, narrative: str, error: dict[str, Any]
) -> bool:
    count = await execute(
        conn,
        """
        UPDATE turns SET status = 'failed', narrative = :narrative, error = CAST(:error AS jsonb)
        WHERE id = :id AND status = 'generating'
        """,
        {"id": turn_id, "narrative": narrative, "error": dumps(error)},
    )
    return count == 1


async def notify_turn(conn: AsyncConnection, turn_id: str) -> None:
    await execute(
        conn, "SELECT pg_notify(:channel, :turn)", {"channel": TURN_NOTIFY_CHANNEL, "turn": turn_id}
    )


# ---- 幂等键 -----------------------------------------------------------------------------


async def get_idempotency_key(
    conn: AsyncConnection, user_id: str, key: str
) -> tuple[str, str] | None:
    row = await fetch_one(
        conn,
        "SELECT request_hash, turn_id FROM idempotency_keys WHERE user_id = :u AND key = :k",
        {"u": user_id, "k": key},
    )
    return None if row is None else (row["request_hash"], str(row["turn_id"]))


async def insert_idempotency_key(
    conn: AsyncConnection, user_id: str, key: str, request_hash: str, turn_id: str
) -> None:
    await execute(
        conn,
        """INSERT INTO idempotency_keys (user_id, key, request_hash, turn_id)
           VALUES (:u, :k, :h, :t)""",
        {"u": user_id, "k": key, "h": request_hash, "t": turn_id},
    )


async def purge_idempotency_keys(conn: AsyncConnection, older_than_s: float = 86400.0) -> int:
    return await execute(
        conn,
        "DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(secs => :s)",
        {"s": float(older_than_s)},
    )
