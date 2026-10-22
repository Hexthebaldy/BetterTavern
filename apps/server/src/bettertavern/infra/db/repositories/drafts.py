"""工作台的草稿：workbench_drafts 与 workbench_assets（草稿里的图片）。

手动模式的自动保存和 agent 的每次写入都带草稿的版本号（版本围栏），对不上就不写，
由调用方返回 409 让对方重读；手动和 agent 不会互相覆盖。
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
    opt_str,
)


@dataclass(frozen=True, slots=True)
class DraftRow:
    id: str
    user_id: str
    card_id: str | None
    base_version: int | None
    origin: str
    name: str
    card: dict[str, Any]
    source_sha256: str | None
    cover_asset_id: str | None
    version: int
    saved_version: int | None
    mode: str
    stage: str
    agent_status: str
    awaiting: dict[str, Any] | None
    plan_approved_seq: int | None
    todos: list[dict[str, Any]]
    agent_baseline: dict[str, Any] | None
    language: str
    stop_requested: bool
    last_seq: int
    created_at: datetime
    updated_at: datetime
    cover_blob_id: str | None = None  # 封面那张图的 blob（查询时一起带出来）

    @property
    def unsaved(self) -> bool:
        return self.saved_version != self.version

    @classmethod
    def from_row(cls, row: Row) -> DraftRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            card_id=opt_str(row["card_id"]),
            base_version=row["base_version"],
            origin=row["origin"],
            name=row["name"],
            card=as_json(row["card"], {}) or {},
            source_sha256=row["source_sha256"],
            cover_asset_id=opt_str(row["cover_asset_id"]),
            version=row["version"],
            saved_version=row["saved_version"],
            mode=row["mode"],
            stage=row["stage"],
            agent_status=row["agent_status"],
            awaiting=as_json(row["awaiting"]),
            plan_approved_seq=row["plan_approved_seq"],
            todos=as_json(row["todos"], []) or [],
            agent_baseline=as_json(row["agent_baseline"]),
            language=row["language"],
            stop_requested=bool(row["stop_requested"]),
            last_seq=row["last_seq"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            cover_blob_id=opt_str(row.get("cover_blob_id")),
        )


_COLS = """d.id, d.user_id, d.card_id, d.base_version, d.origin, d.name, d.card, d.source_sha256,
    d.cover_asset_id, d.version, d.saved_version, d.mode, d.stage,
    -- 心跳过期的“正在跑”（worker 意外退出）当作已经停了
    CASE WHEN d.agent_status = 'running' AND d.run_heartbeat_at < now() - interval '300 seconds'
         THEN 'idle' ELSE d.agent_status END AS agent_status, d.awaiting,
    d.plan_approved_seq, d.todos, d.agent_baseline, d.language, d.stop_requested, d.last_seq,
    d.created_at, d.updated_at,
    (SELECT a.blob_id FROM workbench_assets AS a WHERE a.id = d.cover_asset_id) AS cover_blob_id"""


async def insert_draft(
    conn: AsyncConnection,
    *,
    user_id: str,
    origin: str,
    name: str,
    card: dict[str, Any],
    raw: Any = None,
    source_sha256: str | None = None,
    card_id: str | None = None,
    base_version: int | None = None,
    mode: str = "manual",
    stage: str = "start",
    language: str = "zh",
) -> DraftRow:
    row = await fetch_one(
        conn,
        """
        INSERT INTO workbench_drafts (user_id, origin, name, card, raw, source_sha256, card_id,
                                      base_version, mode, stage, language)
        VALUES (:u, :origin, :name, CAST(:card AS jsonb), CAST(:raw AS jsonb), :sha, :card_id,
                :base, :mode, :stage, :lang)
        RETURNING id
        """,
        {
            "u": user_id,
            "origin": origin,
            "name": name,
            "card": dumps(card),
            "raw": None if raw is None else dumps(raw),
            "sha": source_sha256,
            "card_id": card_id,
            "base": base_version,
            "mode": mode,
            "stage": stage,
            "lang": language,
        },
    )
    assert row is not None
    draft = await get_draft(conn, user_id, str(row["id"]))
    assert draft is not None
    return draft


async def get_draft(
    conn: AsyncConnection, user_id: str, draft_id: str, *, lock: bool = False
) -> DraftRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM workbench_drafts AS d WHERE d.id = :id AND d.user_id = :u"
        + (" FOR UPDATE OF d" if lock else ""),
        {"id": draft_id, "u": user_id},
    )
    return None if row is None else DraftRow.from_row(row)


async def get_draft_raw(conn: AsyncConnection, draft_id: str) -> Any | None:
    row = await fetch_one(conn, "SELECT raw FROM workbench_drafts WHERE id = :id", {"id": draft_id})
    return None if row is None else as_json(row["raw"])


async def find_draft_for_card(conn: AsyncConnection, user_id: str, card_id: str) -> DraftRow | None:
    """这张卡最近的一份草稿（保存过的也算，下次打开接着用它）。"""
    row = await fetch_one(
        conn,
        f"""SELECT {_COLS} FROM workbench_drafts AS d WHERE d.user_id = :u AND d.card_id = :c
            ORDER BY d.updated_at DESC LIMIT 1""",
        {"u": user_id, "c": card_id},
    )
    return None if row is None else DraftRow.from_row(row)


async def list_unsaved_drafts(conn: AsyncConnection, user_id: str) -> list[DraftRow]:
    """有没保存修改的草稿，按最近改动倒序。"""
    rows = await fetch_all(
        conn,
        f"""SELECT {_COLS} FROM workbench_drafts AS d
            WHERE d.user_id = :u AND (d.saved_version IS NULL OR d.saved_version <> d.version)
            ORDER BY d.updated_at DESC, d.id""",
        {"u": user_id},
    )
    return [DraftRow.from_row(r) for r in rows]


async def count_unsaved_drafts(conn: AsyncConnection, user_id: str) -> int:
    row = await fetch_one(
        conn,
        """SELECT count(*) AS n FROM workbench_drafts
           WHERE user_id = :u AND (saved_version IS NULL OR saved_version <> version)""",
        {"u": user_id},
    )
    return int(row["n"]) if row is not None else 0


async def update_content(
    conn: AsyncConnection,
    user_id: str,
    draft_id: str,
    *,
    expected_version: int,
    name: str,
    card: dict[str, Any],
) -> DraftRow | None:
    """改卡片内容和显示名，版本号加 1；版本号对不上或草稿不存在时返回 None。"""
    row = await fetch_one(
        conn,
        """UPDATE workbench_drafts
           SET name = :name, card = CAST(:card AS jsonb), version = version + 1, updated_at = now()
           WHERE id = :id AND user_id = :u AND version = :v
           RETURNING id""",
        {"id": draft_id, "u": user_id, "v": expected_version, "name": name, "card": dumps(card)},
    )
    if row is None:
        return None
    return await get_draft(conn, user_id, draft_id)


async def set_mode(
    conn: AsyncConnection, user_id: str, draft_id: str, mode: str
) -> DraftRow | None:
    """切模式只记下次默认用哪种，不算内容的修改（版本号不变）。"""
    row = await fetch_one(
        conn,
        "UPDATE workbench_drafts SET mode = :m WHERE id = :id AND user_id = :u RETURNING id",
        {"id": draft_id, "u": user_id, "m": mode},
    )
    if row is None:
        return None
    return await get_draft(conn, user_id, draft_id)


async def set_cover(
    conn: AsyncConnection, user_id: str, draft_id: str, asset_id: str | None
) -> DraftRow | None:
    """换封面算一次修改：版本号加 1。"""
    row = await fetch_one(
        conn,
        """UPDATE workbench_drafts
           SET cover_asset_id = :a, version = version + 1, updated_at = now()
           WHERE id = :id AND user_id = :u RETURNING id""",
        {"id": draft_id, "u": user_id, "a": asset_id},
    )
    if row is None:
        return None
    return await get_draft(conn, user_id, draft_id)


async def mark_saved(
    conn: AsyncConnection, draft_id: str, *, card_id: str, base_version: int, saved_version: int
) -> None:
    """保存到仓库以后：记下对应的卡、它现在的版本，以及草稿保存时的版本（两者相等就是没有新修改）。"""
    await execute(
        conn,
        """UPDATE workbench_drafts
           SET card_id = :c, base_version = :b, saved_version = :s, updated_at = now()
           WHERE id = :id""",
        {"id": draft_id, "c": card_id, "b": base_version, "s": saved_version},
    )


async def delete_draft(conn: AsyncConnection, user_id: str, draft_id: str) -> list[str] | None:
    """删掉草稿（图片记录一起删），返回这些图片的 blob id，由调用方清理没人用的图；
    不存在时返回 None。"""
    rows = await fetch_all(
        conn,
        "SELECT blob_id FROM workbench_assets WHERE draft_id = :id AND user_id = :u",
        {"id": draft_id, "u": user_id},
    )
    deleted = await execute(
        conn,
        "DELETE FROM workbench_drafts WHERE id = :id AND user_id = :u",
        {"id": draft_id, "u": user_id},
    )
    if deleted == 0:
        return None
    return [str(r["blob_id"]) for r in rows]


# ---- workbench_assets ----


@dataclass(frozen=True, slots=True)
class AssetRow:
    id: str
    draft_id: str
    blob_id: str
    source: str
    license: str
    source_url: str | None
    prompt: str | None
    meta: dict[str, Any]
    created_at: datetime
    mime: str = ""
    width: int | None = None
    height: int | None = None

    @classmethod
    def from_row(cls, row: Row) -> AssetRow:
        return cls(
            id=str(row["id"]),
            draft_id=str(row["draft_id"]),
            blob_id=str(row["blob_id"]),
            source=row["source"],
            license=row["license"],
            source_url=row["source_url"],
            prompt=row["prompt"],
            meta=as_json(row["meta"], {}) or {},
            created_at=row["created_at"],
            mime=row.get("mime") or "",
            width=row.get("width"),
            height=row.get("height"),
        )


_ASSET_COLS = """a.id, a.draft_id, a.blob_id, a.source, a.license, a.source_url, a.prompt, a.meta,
    a.created_at, b.mime, b.width, b.height"""


async def insert_asset(
    conn: AsyncConnection,
    *,
    user_id: str,
    draft_id: str,
    blob_id: str,
    source: str,
    license: str,
    source_url: str | None = None,
    prompt: str | None = None,
    meta: dict[str, Any] | None = None,
) -> AssetRow:
    row = await fetch_one(
        conn,
        """INSERT INTO workbench_assets (user_id, draft_id, blob_id, source, license, source_url,
                                         prompt, meta)
           VALUES (:u, :d, :b, :source, :license, :url, :prompt, CAST(:meta AS jsonb))
           RETURNING id""",
        {
            "u": user_id,
            "d": draft_id,
            "b": blob_id,
            "source": source,
            "license": license,
            "url": source_url,
            "prompt": prompt,
            "meta": dumps(meta or {}),
        },
    )
    assert row is not None
    asset = await get_asset(conn, user_id, str(row["id"]))
    assert asset is not None
    return asset


async def get_asset(conn: AsyncConnection, user_id: str, asset_id: str) -> AssetRow | None:
    row = await fetch_one(
        conn,
        f"""SELECT {_ASSET_COLS} FROM workbench_assets AS a JOIN blobs AS b ON b.id = a.blob_id
            WHERE a.id = :id AND a.user_id = :u""",
        {"id": asset_id, "u": user_id},
    )
    return None if row is None else AssetRow.from_row(row)


async def list_assets(conn: AsyncConnection, draft_id: str) -> list[AssetRow]:
    rows = await fetch_all(
        conn,
        f"""SELECT {_ASSET_COLS} FROM workbench_assets AS a JOIN blobs AS b ON b.id = a.blob_id
            WHERE a.draft_id = :d ORDER BY a.created_at, a.id""",
        {"d": draft_id},
    )
    return [AssetRow.from_row(r) for r in rows]


async def find_asset_by_blob(conn: AsyncConnection, draft_id: str, blob_id: str) -> AssetRow | None:
    row = await fetch_one(
        conn,
        f"""SELECT {_ASSET_COLS} FROM workbench_assets AS a JOIN blobs AS b ON b.id = a.blob_id
            WHERE a.draft_id = :d AND a.blob_id = :b ORDER BY a.created_at LIMIT 1""",
        {"d": draft_id, "b": blob_id},
    )
    return None if row is None else AssetRow.from_row(row)


async def update_asset_meta(conn: AsyncConnection, asset_id: str, meta: dict[str, Any]) -> None:
    await execute(
        conn,
        "UPDATE workbench_assets SET meta = CAST(:m AS jsonb) WHERE id = :id",
        {"id": asset_id, "m": dumps(meta)},
    )


async def request_stop(conn: AsyncConnection, user_id: str, draft_id: str) -> bool:
    """agent 正在跑时置 stop_requested（做完手上这一步就收尾）；没在跑返回 False。"""
    count = await execute(
        conn,
        """UPDATE workbench_drafts SET stop_requested = true
           WHERE id = :id AND user_id = :u AND agent_status = 'running'""",
        {"id": draft_id, "u": user_id},
    )
    return count > 0
