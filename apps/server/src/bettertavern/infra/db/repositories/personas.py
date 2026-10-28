"""人设库：personas（F3，docs/personas.md）。

剧本选了哪个人设记在 scenarios.setup.persona_id（JSON 里，没有外键）：人设改了名字和描述时，
把选了它的剧本里的 setup.protagonist 副本跟着改；删人设时把这些剧本的 persona_id 和副本一起清掉。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import Row, execute, fetch_all, fetch_one, fetch_value, opt_str

# 剧本里 setup.protagonist 副本的描述只留这么多（domain/scenario/setup.py 的上限）
MIRROR_SUMMARY_CHARS = 400


@dataclass(frozen=True, slots=True)
class PersonaRow:
    id: str
    user_id: str
    name: str
    description: str
    avatar_blob_id: str | None
    is_default: bool
    scenario_count: int  # 几个剧本选了它
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: Row) -> PersonaRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            name=row["name"],
            description=row["description"],
            avatar_blob_id=opt_str(row["avatar_blob_id"]),
            is_default=bool(row["is_default"]),
            scenario_count=int(row["scenario_count"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


_COLS = """p.id, p.user_id, p.name, p.description, p.avatar_blob_id, p.is_default,
    p.created_at, p.updated_at,
    (SELECT count(*) FROM scenarios AS s
      WHERE s.user_id = p.user_id AND s.setup ->> 'persona_id' = p.id::text) AS scenario_count"""


async def count_personas(conn: AsyncConnection, user_id: str) -> int:
    value = await fetch_value(
        conn, "SELECT count(*) FROM personas WHERE user_id = :u", {"u": user_id}
    )
    return int(value or 0)


async def list_personas(conn: AsyncConnection, user_id: str) -> list[PersonaRow]:
    """默认人设排第一，其余按建的先后。"""
    rows = await fetch_all(
        conn,
        f"""SELECT {_COLS} FROM personas AS p WHERE p.user_id = :u
            ORDER BY p.is_default DESC, p.created_at, p.id""",
        {"u": user_id},
    )
    return [PersonaRow.from_row(r) for r in rows]


async def get_persona(
    conn: AsyncConnection, user_id: str, persona_id: str, *, lock: bool = False
) -> PersonaRow | None:
    row = await fetch_one(
        conn,
        f"""SELECT {_COLS} FROM personas AS p WHERE p.id = :id AND p.user_id = :u
            {"FOR UPDATE OF p" if lock else ""}""",
        {"id": persona_id, "u": user_id},
    )
    return PersonaRow.from_row(row) if row is not None else None


async def insert_persona(
    conn: AsyncConnection, *, user_id: str, name: str, description: str, is_default: bool = False
) -> PersonaRow:
    if is_default:
        await clear_default(conn, user_id)
    row = await fetch_one(
        conn,
        f"""INSERT INTO personas AS p (user_id, name, description, is_default)
            VALUES (:u, :name, :description, :d)
            RETURNING {_COLS}""",
        {"u": user_id, "name": name, "description": description, "d": is_default},
    )
    assert row is not None
    return PersonaRow.from_row(row)


async def update_persona(
    conn: AsyncConnection, user_id: str, persona_id: str, *, name: str, description: str
) -> PersonaRow | None:
    row = await fetch_one(
        conn,
        f"""UPDATE personas AS p SET name = :name, description = :description, updated_at = now()
            WHERE p.id = :id AND p.user_id = :u
            RETURNING {_COLS}""",
        {"id": persona_id, "u": user_id, "name": name, "description": description},
    )
    return PersonaRow.from_row(row) if row is not None else None


async def clear_default(conn: AsyncConnection, user_id: str) -> None:
    await execute(
        conn,
        "UPDATE personas SET is_default = false WHERE user_id = :u AND is_default",
        {"u": user_id},
    )


async def set_default(conn: AsyncConnection, user_id: str, persona_id: str, value: bool) -> None:
    """设成默认时先把原来的默认人设取消（每个用户最多一个，有部分唯一索引兜底）。"""
    if value:
        await clear_default(conn, user_id)
    await execute(
        conn,
        """UPDATE personas SET is_default = :v, updated_at = now()
           WHERE id = :id AND user_id = :u""",
        {"id": persona_id, "u": user_id, "v": value},
    )


async def set_avatar(
    conn: AsyncConnection, user_id: str, persona_id: str, blob_id: str | None
) -> None:
    await execute(
        conn,
        """UPDATE personas SET avatar_blob_id = :b, updated_at = now()
           WHERE id = :id AND user_id = :u""",
        {"id": persona_id, "u": user_id, "b": blob_id},
    )


async def delete_persona(conn: AsyncConnection, user_id: str, persona_id: str) -> bool:
    return (
        await execute(
            conn,
            "DELETE FROM personas WHERE id = :id AND user_id = :u",
            {"id": persona_id, "u": user_id},
        )
        > 0
    )


async def sync_scenarios(
    conn: AsyncConnection, user_id: str, persona_id: str, *, name: str, description: str
) -> int:
    """选了这个人设的剧本：setup.protagonist 副本换成人设现在的名字和描述（描述截到 400 字）。"""
    return await execute(
        conn,
        """UPDATE scenarios
           SET setup = jsonb_set(setup, '{protagonist}',
                                 jsonb_build_object('name', CAST(:name AS text),
                                                    'summary', CAST(:summary AS text)))
           WHERE user_id = :u AND setup ->> 'persona_id' = :id""",
        {
            "u": user_id,
            "id": persona_id,
            "name": name,
            "summary": description[:MIRROR_SUMMARY_CHARS],
        },
    )


async def unbind_scenarios(conn: AsyncConnection, user_id: str, persona_id: str) -> int:
    """删人设时：选了它的剧本不再选人设，默认主角的副本也清掉（不改剧本的版本号）。"""
    return await execute(
        conn,
        """UPDATE scenarios
           SET setup = jsonb_set(setup - 'persona_id', '{protagonist}',
                                 '{"name": "", "summary": ""}'::jsonb)
           WHERE user_id = :u AND setup ->> 'persona_id' = :id""",
        {"u": user_id, "id": persona_id},
    )
