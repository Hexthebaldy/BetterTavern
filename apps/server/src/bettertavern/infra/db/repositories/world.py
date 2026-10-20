"""世界状态：entities、entity_links、facts。

现在只有开局写入和读取；修改与撤销日志随 agent runtime 阶段 2 加入。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import Row, as_json, dumps, execute, fetch_all, fetch_one


@dataclass(frozen=True, slots=True)
class EntityRow:
    id: str
    kind: str
    name: str
    aliases: tuple[str, ...]
    summary: str
    data: dict[str, Any]
    canon: str
    is_protagonist: bool
    first_seq: int
    last_seen_seq: int

    @classmethod
    def from_row(cls, row: Row) -> EntityRow:
        return cls(
            id=str(row["id"]),
            kind=row["kind"],
            name=row["name"],
            aliases=tuple(row["aliases"] or ()),
            summary=row["summary"],
            data=as_json(row["data"], {}),
            canon=row["canon"],
            is_protagonist=bool(row["is_protagonist"]),
            first_seq=int(row["first_seq"]),
            last_seen_seq=int(row["last_seen_seq"]),
        )


@dataclass(frozen=True, slots=True)
class LinkRow:
    src_id: str
    rel: str
    dst_id: str


@dataclass(frozen=True, slots=True)
class FactRow:
    id: str
    text: str
    entity_ids: tuple[str, ...]
    visibility: str
    known_by: tuple[str, ...]
    created_seq: int


async def insert_entity(
    conn: AsyncConnection,
    *,
    playthrough_id: str,
    kind: str,
    name: str,
    name_norm: str,
    aliases: list[str],
    summary: str,
    data: dict[str, Any],
    is_protagonist: bool,
    seq: int = 0,
) -> str:
    row = await fetch_one(
        conn,
        """
        INSERT INTO entities (playthrough_id, kind, name, name_norm, aliases, summary, data,
                              canon, is_protagonist, first_seq, last_seen_seq)
        VALUES (:pt, :kind, :name, :norm, CAST(:aliases AS text[]), :summary,
                CAST(:data AS jsonb), 'canon', :hero, :seq, :seq)
        RETURNING id
        """,
        {
            "pt": playthrough_id,
            "kind": kind,
            "name": name,
            "norm": name_norm,
            "aliases": aliases,
            "summary": summary,
            "data": dumps(data),
            "hero": is_protagonist,
            "seq": seq,
        },
    )
    assert row is not None
    return str(row["id"])


async def update_entity_data(conn: AsyncConnection, entity_id: str, data: dict[str, Any]) -> None:
    await execute(
        conn,
        "UPDATE entities SET data = CAST(:data AS jsonb), rev = rev + 1 WHERE id = :id",
        {"id": entity_id, "data": dumps(data)},
    )


async def insert_link(
    conn: AsyncConnection, *, playthrough_id: str, src_id: str, rel: str, dst_id: str, seq: int = 0
) -> None:
    await execute(
        conn,
        """
        INSERT INTO entity_links (playthrough_id, src_id, rel, dst_id, since_seq)
        VALUES (:pt, :src, :rel, :dst, :seq)
        ON CONFLICT DO NOTHING
        """,
        {"pt": playthrough_id, "src": src_id, "rel": rel, "dst": dst_id, "seq": seq},
    )


async def insert_fact(
    conn: AsyncConnection,
    *,
    playthrough_id: str,
    text: str,
    entity_ids: list[str],
    visibility: str,
    known_by: list[str],
    seq: int = 0,
) -> str:
    row = await fetch_one(
        conn,
        """
        INSERT INTO facts (playthrough_id, text, entity_ids, visibility, known_by, created_seq)
        VALUES (:pt, :text, CAST(:entities AS uuid[]), :visibility, CAST(:known AS uuid[]), :seq)
        RETURNING id
        """,
        {
            "pt": playthrough_id,
            "text": text,
            "entities": entity_ids,
            "visibility": visibility,
            "known": known_by,
            "seq": seq,
        },
    )
    assert row is not None
    return str(row["id"])


async def load_entities(conn: AsyncConnection, playthrough_id: str) -> list[EntityRow]:
    rows = await fetch_all(
        conn,
        """
        SELECT id, kind, name, aliases, summary, data, canon, is_protagonist,
               first_seq, last_seen_seq
        FROM entities WHERE playthrough_id = :pt AND NOT retired
        ORDER BY kind, last_seen_seq DESC, first_seq, name_norm
        """,
        {"pt": playthrough_id},
    )
    return [EntityRow.from_row(r) for r in rows]


async def load_links(conn: AsyncConnection, playthrough_id: str) -> list[LinkRow]:
    rows = await fetch_all(
        conn,
        """
        SELECT l.src_id, l.rel, l.dst_id FROM entity_links AS l
        WHERE l.playthrough_id = :pt
        ORDER BY l.rel, l.src_id, l.dst_id
        """,
        {"pt": playthrough_id},
    )
    return [LinkRow(str(r["src_id"]), r["rel"], str(r["dst_id"])) for r in rows]


async def load_facts(conn: AsyncConnection, playthrough_id: str) -> list[FactRow]:
    rows = await fetch_all(
        conn,
        """
        SELECT id, text, entity_ids, visibility, known_by, created_seq FROM facts
        WHERE playthrough_id = :pt AND status = 'active'
        ORDER BY created_seq DESC, id
        """,
        {"pt": playthrough_id},
    )
    return [
        FactRow(
            id=str(r["id"]),
            text=r["text"],
            entity_ids=tuple(str(x) for x in r["entity_ids"] or ()),
            visibility=r["visibility"],
            known_by=tuple(str(x) for x in r["known_by"] or ()),
            created_seq=int(r["created_seq"]),
        )
        for r in rows
    ]


async def count_entities(conn: AsyncConnection, playthrough_id: str) -> int:
    row = await fetch_one(
        conn,
        "SELECT count(*) AS n FROM entities WHERE playthrough_id = :pt AND NOT retired",
        {"pt": playthrough_id},
    )
    return int(row["n"]) if row else 0
