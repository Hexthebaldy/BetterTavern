"""WorkbenchStore 的 Postgres 实现：worker 里的工作台 agent 通过它读写草稿、对话记录和推送事件。

写入都带 run_id（只有正在跑的那一轮能写）；写卡另外带草稿的版本号（手动和 agent 不会互相覆盖）。
每次写卡、发消息都在同一个事务里写一条推送事件并 NOTIFY，api 进程收到后推给客户端。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.infra.db.repositories import drafts as drafts_repo
from bettertavern.infra.db.repositories import workbench as repo
from bettertavern.runtime.ports import (
    DraftSnapshot,
    WorkbenchAsset,
    WorkbenchFinish,
    WorkbenchMessage,
    WorkbenchNote,
    WorkbenchRun,
)

from .run_records import insert_run


def message_payload(row: repo.MessageRow) -> dict[str, Any]:
    """推送事件和接口里一条对话记录的样子。"""
    return {
        "seq": row.seq,
        "role": row.role,
        "kind": row.kind,
        "content": row.content,
        "created_at": row.created_at.isoformat(),
    }


class PgWorkbenchStore:
    def __init__(self, engine: AsyncEngine, *, notes: Any = None) -> None:
        self._engine = engine
        # 联网以后的资料笔记读取（services/web_store.py）；没有时不带笔记
        self._notes = notes

    async def load_run(self, draft_id: str, run_id: str) -> WorkbenchRun | None:
        async with self._engine.connect() as conn:
            user_id = await repo.run_owner(conn, draft_id, run_id)
            if user_id is None:
                return None
            draft = await drafts_repo.get_draft(conn, user_id, draft_id)
            if draft is None:
                return None
            messages = await repo.list_messages(conn, draft_id)
            assets = await drafts_repo.list_assets(conn, draft_id)
            notes = await self._notes.list(conn, draft_id) if self._notes is not None else []
            trigger = await _trigger_of(conn, draft_id, run_id)
        return WorkbenchRun(
            run_id=run_id,
            draft_id=draft_id,
            user_id=user_id,
            trigger=trigger,
            origin=draft.origin,
            stage=draft.stage,
            language=draft.language,
            name=draft.name,
            card=CharacterCard.model_validate(draft.card),
            version=draft.version,
            cover_asset_id=draft.cover_asset_id,
            plan_approved_seq=draft.plan_approved_seq,
            todos=tuple(draft.todos),
            baseline=draft.agent_baseline,
            messages=tuple(
                WorkbenchMessage(
                    seq=m.seq,
                    role="user" if m.role == "user" else "assistant",
                    kind=m.kind,
                    content=m.content,
                )
                for m in messages
            ),
            assets=tuple(
                WorkbenchAsset(
                    id=a.id,
                    blob_id=a.blob_id,
                    source=a.source,
                    license=a.license,
                    source_url=a.source_url,
                    prompt=a.prompt,
                    width=a.width,
                    height=a.height,
                    meta=a.meta,
                )
                for a in assets
            ),
            notes=tuple(
                WorkbenchNote(id=n.id, text=n.text, source=n.source, used_in=tuple(n.used_in))
                for n in notes
            ),
        )

    async def should_stop(self, draft_id: str, run_id: str) -> bool:
        async with self._engine.begin() as conn:
            stop = await repo.heartbeat(conn, draft_id, run_id)
        return stop is None or stop

    async def emit(
        self, draft_id: str, run_id: str, events: Sequence[tuple[str, Mapping[str, Any]]]
    ) -> None:
        async with self._engine.begin() as conn:
            await repo.insert_events(conn, draft_id, run_id, events)

    async def read_draft(self, draft_id: str) -> DraftSnapshot | None:
        async with self._engine.connect() as conn:
            row = await _draft_by_id(conn, draft_id)
        if row is None:
            return None
        return DraftSnapshot(
            version=row["version"],
            name=row["name"],
            card=CharacterCard.model_validate(row["card"]),
        )

    async def write_card(
        self,
        draft_id: str,
        run_id: str,
        *,
        expected_version: int,
        name: str,
        card: CharacterCard,
        fields: Sequence[str],
    ) -> int | None:
        async with self._engine.begin() as conn:
            version = await repo.write_card(
                conn,
                draft_id,
                run_id,
                expected_version=expected_version,
                name=name,
                card=card.model_dump(mode="json"),
            )
            if version is not None:
                await repo.insert_events(
                    conn,
                    draft_id,
                    run_id,
                    [("draft", {"version": version, "fields": list(fields)})],
                )
        return version

    async def append_message(
        self, draft_id: str, run_id: str, *, kind: str, content: Mapping[str, Any]
    ) -> int:
        async with self._engine.begin() as conn:
            row = await repo.insert_message(
                conn, draft_id, role="assistant", kind=kind, content=content, run_id=run_id
            )
            await repo.insert_events(conn, draft_id, run_id, [("message", message_payload(row))])
        return row.seq

    async def set_todos(
        self, draft_id: str, run_id: str, todos: Sequence[Mapping[str, Any]]
    ) -> None:
        async with self._engine.begin() as conn:
            await repo.set_run_fields(conn, draft_id, run_id, todos=[dict(t) for t in todos])

    async def set_stage(self, draft_id: str, run_id: str, stage: str) -> None:
        async with self._engine.begin() as conn:
            if await repo.set_run_fields(conn, draft_id, run_id, stage=stage):
                await repo.insert_events(conn, draft_id, run_id, [("status", {"stage": stage})])

    async def set_cover(self, draft_id: str, run_id: str, asset_id: str | None) -> int | None:
        async with self._engine.begin() as conn:
            return await repo.set_run_cover(conn, draft_id, run_id, asset_id)

    async def finish(self, draft_id: str, run_id: str, result: WorkbenchFinish) -> None:
        async with self._engine.begin() as conn:
            row = await _draft_by_id(conn, draft_id)
            if row is None:
                return
            baseline = {"card": row["card"], "display_name": row["name"]}
            await repo.finish_run(
                conn,
                draft_id,
                run_id,
                stage=result.stage,
                agent_status=result.agent_status,
                awaiting=result.awaiting,
                baseline=baseline,
            )
            # 没写成（已经被别的一轮接管）时草稿的状态不动，只记这一轮的账
            await insert_run(
                conn,
                result.run,
                user_id=str(row["user_id"]),
                playthrough_id=None,
                turn_id=None,
                draft_id=draft_id,
                run_id=run_id,
            )
            await repo.insert_events(
                conn,
                draft_id,
                run_id,
                [
                    (
                        "status",
                        {
                            "agent_status": result.agent_status,
                            "stage": result.stage,
                            "awaiting": dict(result.awaiting) if result.awaiting else None,
                            "done": True,
                        },
                    )
                ],
            )


async def _draft_by_id(conn: Any, draft_id: str) -> Mapping[str, Any] | None:
    return await repo.draft_basics(conn, draft_id)


async def _trigger_of(conn: Any, draft_id: str, run_id: str) -> Any:
    trigger = await repo.run_trigger(conn, run_id)
    return trigger if trigger in ("text", "answers", "plan_reply", "continue") else "text"
