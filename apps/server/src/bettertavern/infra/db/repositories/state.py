"""世界状态 agent 的读写：整理进度（playthroughs.state_seq）、
按行写入改动（实体、关系、事实、线索）、撤销记录（state_patches）、回合标签（turn_notes）。

写入顺序见 docs/agent-runtime.md 第 8 节：先对 playthroughs 做带条件的 UPDATE（整理进度和时间线编号
都要对得上），成功后才写世界状态表。改动按行写：新建的插入、改过的整行覆盖、删掉的删除。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.domain.world.records import (
    EntityRecord,
    FactRecord,
    LinkRecord,
    RowChange,
    ThreadRecord,
    WorldRecords,
)
from bettertavern.infra.db.sqlutil import as_json, dumps, execute, fetch_all, fetch_one, fetch_value

STATE_AGENT = "state_keeper"


# ---- 读 ---------------------------------------------------------------------------------
async def load_records(conn: AsyncConnection, playthrough_id: str) -> WorldRecords:
    """一局的全部实体（包括已退场的）、关系、有效的事实和没解开的线索，顺序固定。"""
    entities = await fetch_all(
        conn,
        """
        SELECT id, kind, name, name_norm, aliases, summary, data, canon, is_protagonist,
               first_seq, last_seen_seq, rev, retired
        FROM entities WHERE playthrough_id = :pt
        ORDER BY retired, kind, last_seen_seq DESC, first_seq, name_norm, id
        """,
        {"pt": playthrough_id},
    )
    links = await fetch_all(
        conn,
        """
        SELECT src_id, rel, dst_id, since_seq FROM entity_links
        WHERE playthrough_id = :pt ORDER BY rel, src_id, dst_id
        """,
        {"pt": playthrough_id},
    )
    facts = await fetch_all(
        conn,
        """
        SELECT id, text, entity_ids, visibility, known_by, status, superseded_by, superseded_seq,
               created_seq, source_turn_id
        FROM facts WHERE playthrough_id = :pt AND status = 'active'
        ORDER BY created_seq, id
        """,
        {"pt": playthrough_id},
    )
    threads = await fetch_all(
        conn,
        """
        SELECT id, kind, text, entity_ids, status, opened_seq, closed_seq, source_turn_id,
               answer, merged_into
        FROM threads WHERE playthrough_id = :pt AND status = 'open'
        ORDER BY opened_seq, id
        """,
        {"pt": playthrough_id},
    )
    return WorldRecords(
        entities=tuple(
            EntityRecord(
                id=str(r["id"]),
                kind=r["kind"],
                name=r["name"],
                name_norm=r["name_norm"],
                aliases=tuple(r["aliases"] or ()),
                summary=r["summary"],
                data=as_json(r["data"], {}),
                canon=r["canon"],
                is_protagonist=bool(r["is_protagonist"]),
                first_seq=int(r["first_seq"]),
                last_seen_seq=int(r["last_seen_seq"]),
                rev=int(r["rev"]),
                retired=bool(r["retired"]),
            )
            for r in entities
        ),
        links=tuple(
            LinkRecord(str(r["src_id"]), r["rel"], str(r["dst_id"]), int(r["since_seq"]))
            for r in links
        ),
        facts=tuple(
            FactRecord(
                id=str(r["id"]),
                text=r["text"],
                entity_ids=tuple(str(x) for x in r["entity_ids"] or ()),
                visibility=r["visibility"],
                known_by=tuple(str(x) for x in r["known_by"] or ()),
                status=r["status"],
                superseded_by=None if r["superseded_by"] is None else str(r["superseded_by"]),
                superseded_seq=r["superseded_seq"],
                created_seq=int(r["created_seq"]),
                source_turn_id=None if r["source_turn_id"] is None else str(r["source_turn_id"]),
            )
            for r in facts
        ),
        threads=tuple(
            ThreadRecord(
                id=str(r["id"]),
                kind=r["kind"],
                text=r["text"],
                entity_ids=tuple(str(x) for x in r["entity_ids"] or ()),
                status=r["status"],
                opened_seq=int(r["opened_seq"]),
                closed_seq=r["closed_seq"],
                source_turn_id=None if r["source_turn_id"] is None else str(r["source_turn_id"]),
                answer=r["answer"],
                merged_into=None if r["merged_into"] is None else str(r["merged_into"]),
            )
            for r in threads
        ),
    )


@dataclass(frozen=True, slots=True)
class NoteRow:
    seq: int
    digest: str
    entity_ids: tuple[str, ...]
    scene_ended: bool
    skipped: bool


async def recent_notes(
    conn: AsyncConnection, playthrough_id: str, *, before_seq: int, limit: int
) -> list[NoteRow]:
    """before_seq 之前最近几回合的标签，按回合升序。"""
    rows = await fetch_all(
        conn,
        """
        SELECT seq, digest, entity_ids, scene_ended, skipped FROM turn_notes
        WHERE playthrough_id = :pt AND seq < :before
        ORDER BY seq DESC LIMIT :limit
        """,
        {"pt": playthrough_id, "before": before_seq, "limit": limit},
    )
    return [
        NoteRow(
            seq=int(r["seq"]),
            digest=r["digest"],
            entity_ids=tuple(str(x) for x in r["entity_ids"] or ()),
            scene_ended=bool(r["scene_ended"]),
            skipped=bool(r["skipped"]),
        )
        for r in reversed(rows)
    ]


async def scene_start(conn: AsyncConnection, playthrough_id: str, *, before_seq: int) -> int:
    """当前场景从第几回合开始：上一个结束的场景之后的那一回合；还没有场景结束过时是 0。"""
    value = await fetch_value(
        conn,
        """
        SELECT max(seq) FROM turn_notes
        WHERE playthrough_id = :pt AND seq < :before AND scene_ended
        """,
        {"pt": playthrough_id, "before": before_seq},
    )
    return 0 if value is None else int(value) + 1


async def failure_count(conn: AsyncConnection, turn_id: str) -> int:
    """这一回合的世界状态整理失败过几次。"""
    value = await fetch_value(
        conn,
        """
        SELECT count(*) FROM agent_runs
        WHERE turn_id = :turn AND agent = :agent AND status = 'failed'
        """,
        {"turn": turn_id, "agent": STATE_AGENT},
    )
    return int(value or 0)


@dataclass(frozen=True, slots=True)
class StateIssue:
    seq: int
    kind: str  # failed：这一回合整理失败，下一回合会再试；skipped：失败两次，跳过了
    reason: str | None  # 最近一次失败的原因（agent_runs.error_class）


async def state_issue(
    conn: AsyncConnection, playthrough_id: str, *, state_seq: int
) -> StateIssue | None:
    """给玩家看的整理问题：下一回合正在失败，或者最近一次被跳过的回合。"""
    pending = await fetch_one(
        conn,
        """
        SELECT t.seq, r.error_class FROM turns AS t
        JOIN agent_runs AS r ON r.turn_id = t.id
        WHERE t.playthrough_id = :pt AND t.seq = :seq AND t.status = 'replied'
          AND r.agent = :agent AND r.status = 'failed'
        ORDER BY r.created_at DESC LIMIT 1
        """,
        {"pt": playthrough_id, "seq": state_seq + 1, "agent": STATE_AGENT},
    )
    if pending is not None:
        return StateIssue(int(pending["seq"]), "failed", pending["error_class"])
    skipped = await fetch_one(
        conn,
        """
        SELECT n.seq,
               (SELECT r.error_class FROM agent_runs AS r
                WHERE r.turn_id = n.turn_id AND r.agent = :agent AND r.status = 'failed'
                ORDER BY r.created_at DESC LIMIT 1) AS error_class
        FROM turn_notes AS n
        WHERE n.playthrough_id = :pt AND n.skipped
        ORDER BY n.seq DESC LIMIT 1
        """,
        {"pt": playthrough_id, "agent": STATE_AGENT},
    )
    if skipped is not None:
        return StateIssue(int(skipped["seq"]), "skipped", skipped["error_class"])
    return None


# ---- 写 ---------------------------------------------------------------------------------
async def advance_state_seq(
    conn: AsyncConnection, playthrough_id: str, *, seq: int, epoch: int
) -> bool:
    """整理进度从 seq - 1 前进到 seq。期间回退过、或者这一回合已经整理过，返回 False。"""
    count = await execute(
        conn,
        """
        UPDATE playthroughs SET state_seq = :seq
        WHERE id = :id AND state_seq = :seq - 1 AND timeline_epoch = :epoch
        """,
        {"id": playthrough_id, "seq": seq, "epoch": epoch},
    )
    return count == 1


async def mark_committed(conn: AsyncConnection, turn_id: str) -> bool:
    count = await execute(
        conn,
        """
        UPDATE turns SET status = 'committed', committed_at = now()
        WHERE id = :id AND status = 'replied'
        """,
        {"id": turn_id},
    )
    return count == 1


async def insert_note(
    conn: AsyncConnection,
    *,
    turn_id: str,
    playthrough_id: str,
    seq: int,
    digest: str,
    entity_ids: Sequence[str],
    scene_ended: bool,
    skipped: bool = False,
) -> None:
    await execute(
        conn,
        """
        INSERT INTO turn_notes (turn_id, playthrough_id, seq, digest, entity_ids, scene_ended,
                                skipped)
        VALUES (:turn, :pt, :seq, :digest, CAST(:entities AS uuid[]), :ended, :skipped)
        """,
        {
            "turn": turn_id,
            "pt": playthrough_id,
            "seq": seq,
            "digest": digest,
            "entities": list(entity_ids),
            "ended": scene_ended,
            "skipped": skipped,
        },
    )


async def insert_patches(
    conn: AsyncConnection,
    *,
    playthrough_id: str,
    turn_id: str,
    seq: int,
    changes: Sequence[RowChange],
) -> None:
    for idx, change in enumerate(changes):
        await execute(
            conn,
            """
            INSERT INTO state_patches (turn_id, idx, playthrough_id, seq, target, before, after)
            VALUES (:turn, :idx, :pt, :seq, :target, CAST(:before AS jsonb), CAST(:after AS jsonb))
            """,
            {
                "turn": turn_id,
                "idx": idx,
                "pt": playthrough_id,
                "seq": seq,
                "target": change.target,
                "before": None if change.before is None else dumps(change.before),
                "after": None if change.after is None else dumps(change.after),
            },
        )


async def apply_changes(
    conn: AsyncConnection, playthrough_id: str, changes: Sequence[RowChange]
) -> None:
    """按顺序把每一行改成 after 的样子：before 为空就插入，after 为空就删除，否则整行覆盖。"""
    for change in changes:
        if change.target == "entity":
            await _apply_entity(conn, playthrough_id, change)
        elif change.target == "link":
            await _apply_link(conn, playthrough_id, change)
        elif change.target == "thread":
            await _apply_thread(conn, playthrough_id, change)
        else:
            await _apply_fact(conn, playthrough_id, change)


async def _apply_entity(conn: AsyncConnection, playthrough_id: str, change: RowChange) -> None:
    if change.after is None:
        assert change.before is not None
        await execute(conn, "DELETE FROM entities WHERE id = :id", {"id": change.before["id"]})
        return
    row = EntityRecord.from_json(change.after)
    params: dict[str, Any] = {
        "id": row.id,
        "pt": playthrough_id,
        "kind": row.kind,
        "name": row.name,
        "norm": row.name_norm,
        "aliases": list(row.aliases),
        "summary": row.summary,
        "data": dumps(dict(row.data)),
        "canon": row.canon,
        "hero": row.is_protagonist,
        "first": row.first_seq,
        "last": row.last_seen_seq,
        "rev": row.rev,
        "retired": row.retired,
    }
    if change.before is None:
        await execute(
            conn,
            """
            INSERT INTO entities (id, playthrough_id, kind, name, name_norm, aliases, summary,
                                  data, canon, is_protagonist, first_seq, last_seen_seq, rev,
                                  retired)
            VALUES (:id, :pt, :kind, :name, :norm, CAST(:aliases AS text[]), :summary,
                    CAST(:data AS jsonb), :canon, :hero, :first, :last, :rev, :retired)
            """,
            params,
        )
        return
    await execute(
        conn,
        """
        UPDATE entities
        SET kind = :kind, name = :name, name_norm = :norm, aliases = CAST(:aliases AS text[]),
            summary = :summary, data = CAST(:data AS jsonb), canon = :canon,
            is_protagonist = :hero, first_seq = :first, last_seen_seq = :last, rev = :rev,
            retired = :retired
        WHERE id = :id AND playthrough_id = :pt
        """,
        params,
    )


async def _apply_link(conn: AsyncConnection, playthrough_id: str, change: RowChange) -> None:
    if change.after is None:
        assert change.before is not None
        old = LinkRecord.from_json(change.before)
        await execute(
            conn,
            "DELETE FROM entity_links WHERE src_id = :src AND rel = :rel AND dst_id = :dst",
            {"src": old.src_id, "rel": old.rel, "dst": old.dst_id},
        )
        return
    row = LinkRecord.from_json(change.after)
    await execute(
        conn,
        """
        INSERT INTO entity_links (playthrough_id, src_id, rel, dst_id, since_seq)
        VALUES (:pt, :src, :rel, :dst, :since)
        ON CONFLICT (src_id, rel, dst_id) DO UPDATE SET since_seq = EXCLUDED.since_seq
        """,
        {
            "pt": playthrough_id,
            "src": row.src_id,
            "rel": row.rel,
            "dst": row.dst_id,
            "since": row.since_seq,
        },
    )


async def _apply_fact(conn: AsyncConnection, playthrough_id: str, change: RowChange) -> None:
    if change.after is None:
        assert change.before is not None
        await execute(conn, "DELETE FROM facts WHERE id = :id", {"id": change.before["id"]})
        return
    row = FactRecord.from_json(change.after)
    params: dict[str, Any] = {
        "id": row.id,
        "pt": playthrough_id,
        "text": row.text,
        "entities": list(row.entity_ids),
        "visibility": row.visibility,
        "known": list(row.known_by),
        "status": row.status,
        "by": row.superseded_by,
        "sseq": row.superseded_seq,
        "created": row.created_seq,
        "source": row.source_turn_id,
    }
    if change.before is None:
        await execute(
            conn,
            """
            INSERT INTO facts (id, playthrough_id, text, entity_ids, visibility, known_by, status,
                               superseded_by, superseded_seq, created_seq, source_turn_id)
            VALUES (:id, :pt, :text, CAST(:entities AS uuid[]), :visibility,
                    CAST(:known AS uuid[]), :status, CAST(:by AS uuid), :sseq, :created,
                    CAST(:source AS uuid))
            """,
            params,
        )
        return
    await execute(
        conn,
        """
        UPDATE facts
        SET text = :text, entity_ids = CAST(:entities AS uuid[]), visibility = :visibility,
            known_by = CAST(:known AS uuid[]), status = :status,
            superseded_by = CAST(:by AS uuid), superseded_seq = :sseq,
            created_seq = :created, source_turn_id = CAST(:source AS uuid)
        WHERE id = :id AND playthrough_id = :pt
        """,
        params,
    )


async def _apply_thread(conn: AsyncConnection, playthrough_id: str, change: RowChange) -> None:
    if change.after is None:
        assert change.before is not None
        await execute(conn, "DELETE FROM threads WHERE id = :id", {"id": change.before["id"]})
        return
    row = ThreadRecord.from_json(change.after)
    params: dict[str, Any] = {
        "id": row.id,
        "pt": playthrough_id,
        "kind": row.kind,
        "text": row.text,
        "entities": list(row.entity_ids),
        "status": row.status,
        "opened": row.opened_seq,
        "closed": row.closed_seq,
        "source": row.source_turn_id,
        "answer": row.answer,
        "merged": row.merged_into,
    }
    if change.before is None:
        await execute(
            conn,
            """
            INSERT INTO threads (id, playthrough_id, kind, text, entity_ids, status, opened_seq,
                                 closed_seq, source_turn_id, answer, merged_into)
            VALUES (:id, :pt, :kind, :text, CAST(:entities AS uuid[]), :status, :opened, :closed,
                    CAST(:source AS uuid), :answer, CAST(:merged AS uuid))
            """,
            params,
        )
        return
    await execute(
        conn,
        """
        UPDATE threads
        SET kind = :kind, text = :text, entity_ids = CAST(:entities AS uuid[]), status = :status,
            opened_seq = :opened, closed_seq = :closed, source_turn_id = CAST(:source AS uuid),
            answer = :answer, merged_into = CAST(:merged AS uuid)
        WHERE id = :id AND playthrough_id = :pt
        """,
        params,
    )
