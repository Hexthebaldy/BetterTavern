"""点数：余额在 users.credit_micro（微元，1 点 = 1000），每一笔记进 credit_ledger（只追加不改），
领过体验额度的邮箱（HMAC）在 credit_grants。

改余额和记账在同一个事务里：先带条件地改 users 那一行（拿到改后的余额），再写账本。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import execute, fetch_one


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    kind: str  # trial / charge / adjust
    amount_micro: int  # 正数是加，负数是扣
    run_id: str | None = None
    agent: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    cached_tokens: int | None = None
    output_tokens: int | None = None
    note: str = ""


async def balance(conn: AsyncConnection, user_id: str) -> int | None:
    row = await fetch_one(conn, "SELECT credit_micro FROM users WHERE id = :u", {"u": user_id})
    return None if row is None else int(row["credit_micro"])


async def add(conn: AsyncConnection, user_id: str, entry: LedgerEntry) -> int | None:
    """记一笔：改余额，再写账本。返回这一笔之后的余额；用户已经不在了返回 None。"""
    row = await fetch_one(
        conn,
        """UPDATE users SET credit_micro = credit_micro + :amount
           WHERE id = :u RETURNING credit_micro""",
        {"u": user_id, "amount": entry.amount_micro},
    )
    if row is None:
        return None
    after = int(row["credit_micro"])
    await execute(
        conn,
        """INSERT INTO credit_ledger (user_id, kind, amount_micro, balance_micro, run_id, agent,
               model, input_tokens, cached_tokens, output_tokens, note)
           VALUES (:u, :kind, :amount, :after, :run, :agent, :model, :inp, :cached, :out, :note)""",
        {
            "u": user_id,
            "kind": entry.kind,
            "amount": entry.amount_micro,
            "after": after,
            "run": entry.run_id,
            "agent": entry.agent,
            "model": entry.model,
            "inp": entry.input_tokens,
            "cached": entry.cached_tokens,
            "out": entry.output_tokens,
            "note": entry.note,
        },
    )
    return after


async def claim_grant(conn: AsyncConnection, email_hash: str) -> bool:
    """这个邮箱第一次领体验额度时返回 True（并记下）；领过返回 False。"""
    row = await fetch_one(
        conn,
        """INSERT INTO credit_grants (email_hash) VALUES (:h)
           ON CONFLICT (email_hash) DO NOTHING RETURNING email_hash""",
        {"h": email_hash},
    )
    return row is not None


async def spent_since(conn: AsyncConnection, *, seconds: int) -> int:
    """最近这段时间全站在官方模型上花了多少微元。"""
    row = await fetch_one(
        conn,
        """SELECT COALESCE(-SUM(amount_micro), 0) AS spent FROM credit_ledger
           WHERE kind = 'charge' AND created_at > now() - make_interval(secs => :s)""",
        {"s": seconds},
    )
    return int(row["spent"]) if row is not None else 0


async def recent_turn_cost(conn: AsyncConnection, user_id: str, *, seconds: int) -> tuple[int, int]:
    """这个用户最近这段时间：花在有回合的运行上的总额（微元）和涉及的回合数，用来估计每回合花多少。"""
    row = await fetch_one(
        conn,
        """SELECT COALESCE(-SUM(l.amount_micro), 0) AS spent, COUNT(DISTINCT r.turn_id) AS turns
           FROM credit_ledger AS l JOIN agent_runs AS r ON r.id = l.run_id
           WHERE l.user_id = :u AND l.kind = 'charge' AND r.turn_id IS NOT NULL
             AND l.created_at > now() - make_interval(secs => :s)""",
        {"u": user_id, "s": seconds},
    )
    if row is None:
        return 0, 0
    return int(row["spent"]), int(row["turns"])
