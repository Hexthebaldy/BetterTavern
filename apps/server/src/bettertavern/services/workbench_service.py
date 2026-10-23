"""工作台的 agent 模式（docs/workbench.md 第 4.1 节）：开一轮、说话、交问卷、回复方案、接着写完、
对改动做决定、停止，以及对话记录和推送事件。

开一轮：一个事务里写用户的消息、把草稿从 idle / awaiting_user 改成 running（带条件的 UPDATE，
改不动就是已经有一轮在跑：409 DRAFT_BUSY）、放一个 workbench.run 任务。agent 在 worker 里跑。
对改动的决定不开新一轮：采用的几处直接写进草稿（版本号加 1），改前的原文对不上的标成 stale。
文字不进日志。
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

import structlog
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.story.language import parse_language
from bettertavern.domain.workbench.changes import apply_hunks
from bettertavern.domain.workbench.messages import (
    MessageError,
    normalize_answers,
    normalize_plan_reply,
)
from bettertavern.infra.db.repositories import drafts as drafts_repo
from bettertavern.infra.db.repositories import workbench as repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.runtime.events.buffer import StreamEvent

from .credits import CreditService
from .draft_service import DraftView, draft_view, empty_card
from .errors import AppError, Conflict, Invalid, NotFound
from .quotas import Quotas, check_open_drafts, check_running_agents, lock_user
from .workbench_events import WorkbenchEventHub
from .workbench_jobs import enqueue_workbench
from .workbench_store import message_payload

log = structlog.get_logger(__name__)

MAX_TEXT_CHARS = 8000
MessageKind = Literal["text", "answers", "plan_reply"]


@dataclass(frozen=True, slots=True)
class MessageView:
    seq: int
    role: str
    kind: str
    content: dict[str, Any]
    created_at: datetime


@dataclass(frozen=True, slots=True)
class Transcript:
    messages: list[MessageView]
    last_event_id: int  # 订阅推送事件时从它之后开始


def _view(row: repo.MessageRow) -> MessageView:
    return MessageView(
        seq=row.seq, role=row.role, kind=row.kind, content=row.content, created_at=row.created_at
    )


def _busy() -> Conflict:
    return Conflict("The assistant is still working on this draft", code="DRAFT_BUSY")


class WorkbenchService:
    def __init__(
        self,
        engine: AsyncEngine,
        hub: WorkbenchEventHub | None = None,
        quotas: Quotas | None = None,
        credits: CreditService | None = None,
    ) -> None:
        self._engine = engine
        self._credits = credits
        self._quotas = quotas or Quotas()
        self._queue = PgJobQueue(engine)
        self._hub = hub or WorkbenchEventHub(engine)

    async def aclose(self) -> None:
        await self._hub.aclose()

    async def _check_credits(self, user_id: str) -> None:
        """工作台用官方模型时，开新一轮之前要有点数。"""
        if self._credits is not None:
            await self._credits.check_task(user_id, RouteTask.WORKBENCH)

    async def _draft(
        self, conn: AsyncConnection, user_id: str, draft_id: str, *, lock: bool = False
    ) -> drafts_repo.DraftRow:
        if not is_uuid(draft_id):
            raise NotFound("Draft not found")
        row = await drafts_repo.get_draft(conn, user_id, draft_id, lock=lock)
        if row is None:
            raise NotFound("Draft not found")
        return row

    async def _start_run(
        self,
        conn: AsyncConnection,
        user_id: str,
        draft_id: str,
        trigger: str,
        *,
        stage: str | None = None,
        plan_approved_seq: int | None = None,
    ) -> str:
        """调用方在事务开头已经 lock_user。"""
        await check_running_agents(conn, user_id, self._quotas)
        run_id = str(uuid.uuid4())
        if not await repo.start_run(
            conn, user_id, draft_id, run_id, stage=stage, plan_approved_seq=plan_approved_seq
        ):
            raise _busy()
        await enqueue_workbench(conn, self._queue, draft_id, run_id, trigger)
        await repo.insert_events(
            conn, draft_id, run_id, [("status", {"agent_status": "running", "trigger": trigger})]
        )
        log.info("workbench.run_queued", draft_id=draft_id, run_id=run_id, trigger=trigger)
        return run_id

    async def _user_message(
        self, conn: AsyncConnection, draft_id: str, kind: str, content: dict[str, Any]
    ) -> repo.MessageRow:
        row = await repo.insert_message(conn, draft_id, role="user", kind=kind, content=content)
        await repo.insert_events(
            conn, draft_id, repo.API_RUN_ID, [("message", message_payload(row))]
        )
        return row

    # ---- 开始 ----

    async def start(self, user_id: str, *, text: str, language: str) -> DraftView:
        """从聊天框开始：新建草稿，记下用户的第一句话，开第一轮。"""
        text = _clean_text(text)
        await self._check_credits(user_id)
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            await check_open_drafts(conn, user_id, self._quotas)
            row = await drafts_repo.insert_draft(
                conn,
                user_id=user_id,
                origin="agent",
                name="",
                card=empty_card().model_dump(mode="json"),
                mode="agent",
                language=parse_language(language),
            )
            await self._user_message(conn, row.id, "text", {"text": text})
            await self._start_run(conn, user_id, row.id, "text")
            draft = await drafts_repo.get_draft(conn, user_id, row.id)
            assert draft is not None
        log.info("draft.created", draft_id=row.id, origin="agent")
        return draft_view(draft)

    async def post(
        self, user_id: str, draft_id: str, kind: MessageKind, payload: dict[str, Any]
    ) -> MessageView:
        """用户说一句话、交问卷、回复方案；都会开新一轮。"""
        await self._check_credits(user_id)
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            draft = await self._draft(conn, user_id, draft_id, lock=True)
            if draft.agent_status == "running":
                raise _busy()
            stage: str | None = None
            approved_seq: int | None = None
            if kind == "text":
                content: dict[str, Any] = {"text": _clean_text(str(payload.get("text") or ""))}
            elif kind == "answers":
                questions = await self._awaited(conn, draft, "questions")
                try:
                    content = normalize_answers(payload, questions.content)
                except MessageError as exc:
                    raise Invalid(str(exc), field="answers") from exc
                content["questions_seq"] = questions.seq
            else:
                plan = await self._awaited(conn, draft, "plan")
                try:
                    content = normalize_plan_reply(payload, plan.content)
                except MessageError as exc:
                    raise Invalid(str(exc), field="text") from exc
                content["plan_seq"] = plan.seq
                if content["approved"]:
                    stage, approved_seq = "build", plan.seq
            message = await self._user_message(conn, draft_id, kind, content)
            await self._start_run(
                conn, user_id, draft_id, kind, stage=stage, plan_approved_seq=approved_seq
            )
        return _view(message)

    async def _awaited(
        self, conn: AsyncConnection, draft: drafts_repo.DraftRow, kind: str
    ) -> repo.MessageRow:
        awaiting = draft.awaiting or {}
        if awaiting.get("kind") != kind or not isinstance(awaiting.get("seq"), int):
            raise Conflict(
                f"The draft isn't waiting for an answer to a {kind}", code="NOT_AWAITING"
            )
        message = await repo.get_message(conn, draft.id, awaiting["seq"])
        if message is None or message.kind != kind:
            raise Conflict(
                f"The draft isn't waiting for an answer to a {kind}", code="NOT_AWAITING"
            )
        return message

    async def continue_(self, user_id: str, draft_id: str) -> DraftView:
        """让 agent 接着做（从手动切回来，或者上一轮被停下、出错以后）。"""
        await self._check_credits(user_id)
        async with self._engine.begin() as conn:
            await lock_user(conn, user_id)
            draft = await self._draft(conn, user_id, draft_id, lock=True)
            if draft.agent_status == "running":
                raise _busy()
            await self._start_run(conn, user_id, draft_id, "continue")
            updated = await drafts_repo.get_draft(conn, user_id, draft_id)
            assert updated is not None
        return draft_view(updated)

    async def stop(self, user_id: str, draft_id: str, *, quiet: bool = False) -> bool:
        """agent 正在跑时让它做完手上这一步就停；没在跑返回 False。"""
        if not is_uuid(draft_id):
            if quiet:
                return False
            raise NotFound("Draft not found")
        async with self._engine.begin() as conn:
            stopped = await drafts_repo.request_stop(conn, user_id, draft_id)
            if not stopped and not quiet:
                await self._draft(conn, user_id, draft_id)
        if stopped:
            log.info("workbench.stop_requested", draft_id=draft_id)
        return stopped

    # ---- 改动对比 ----

    async def decide(
        self,
        user_id: str,
        draft_id: str,
        seq: int,
        *,
        accept: list[str] | None,
        reject: list[str] | None,
        accept_all: bool = False,
        reject_all: bool = False,
    ) -> tuple[MessageView, DraftView]:
        async with self._engine.begin() as conn:
            draft = await self._draft(conn, user_id, draft_id, lock=True)
            message = await repo.get_message(conn, draft_id, seq)
            if message is None or message.kind != "changes":
                raise NotFound("Changes not found")
            hunks = list(message.content.get("hunks") or [])
            pending = {h["id"] for h in hunks if h.get("state") == "pending"}
            if not pending:
                raise Conflict("These changes were already decided", code="CHANGE_DECIDED")
            if accept_all:
                chosen = set(pending)
            elif reject_all:
                chosen = set()
            else:
                unknown = {*(accept or []), *(reject or [])} - {h["id"] for h in hunks}
                if unknown:
                    raise Invalid(f"Unknown change: {sorted(unknown)[0]}", field="accept")
                chosen = set(accept or []) & pending
                decided = chosen | set(reject or [])
                # 没提到的保持 pending：逐条看时一次只决定一部分
                hunks = [
                    h
                    if h["id"] in decided or h.get("state") != "pending"
                    else {**h, "state": "keep"}
                    for h in hunks
                ]
            card = CharacterCard.model_validate(draft.card)
            updated_card, decided_hunks = apply_hunks(card, hunks, chosen)
            decided_hunks = [
                {**h, "state": "pending"} if h.get("state") == "keep" else h for h in decided_hunks
            ]
            accepted = [h for h in decided_hunks if h["state"] == "accepted" and h["id"] in chosen]
            new_content = {**message.content, "hunks": decided_hunks}
            await repo.update_message(conn, draft_id, seq, new_content)
            current = draft
            if accepted:
                written = await drafts_repo.update_content(
                    conn,
                    user_id,
                    draft_id,
                    expected_version=draft.version,
                    name=draft.name,
                    card=updated_card.model_dump(mode="json"),
                )
                assert written is not None  # 已经锁住了这一行
                current = written
            still_pending = any(h["state"] == "pending" for h in decided_hunks)
            awaiting = draft.awaiting or {}
            if (
                not still_pending
                and awaiting.get("kind") == "changes"
                and awaiting.get("seq") == seq
            ):
                await repo.clear_awaiting(conn, draft_id)
            refreshed = await drafts_repo.get_draft(conn, user_id, draft_id)
            assert refreshed is not None
            events: list[tuple[str, dict[str, Any]]] = [
                (
                    "message",
                    {
                        "seq": seq,
                        "role": message.role,
                        "kind": message.kind,
                        "content": new_content,
                        "created_at": message.created_at.isoformat(),
                    },
                )
            ]
            if accepted:
                events.append(("draft", {"version": current.version, "fields": ["changes"]}))
            events.append(
                ("status", {"agent_status": refreshed.agent_status, "awaiting": refreshed.awaiting})
            )
            await repo.insert_events(conn, draft_id, repo.API_RUN_ID, events)
            assets = await drafts_repo.list_assets(conn, draft_id)
        log.info(
            "workbench.changes_decided",
            draft_id=draft_id,
            seq=seq,
            accepted=len(accepted),
            stale=sum(1 for h in decided_hunks if h["state"] == "stale"),
        )
        updated_message = MessageView(
            seq=seq,
            role=message.role,
            kind=message.kind,
            content=new_content,
            created_at=message.created_at,
        )
        return updated_message, draft_view(refreshed, assets)

    # ---- 读 ----

    async def transcript(self, user_id: str, draft_id: str) -> Transcript:
        async with self._engine.connect() as conn:
            await self._draft(conn, user_id, draft_id)
            last = await repo.last_event_id(conn, draft_id)
            rows = await repo.list_messages(conn, draft_id)
        return Transcript(messages=[_view(r) for r in rows], last_event_id=last)

    async def events(
        self, user_id: str, draft_id: str, *, after: int
    ) -> AsyncIterator[StreamEvent]:
        async with self._engine.connect() as conn:
            await self._draft(conn, user_id, draft_id)

        async def stream() -> AsyncIterator[StreamEvent]:
            last = after
            wake = await self._hub.subscribe(draft_id)
            try:
                while True:
                    wake.clear()
                    async with self._engine.connect() as conn:
                        rows = await repo.events_after(conn, draft_id, last)
                    for row in rows:
                        last = row.id
                        yield StreamEvent(
                            stream_id=draft_id,
                            seq=row.id,
                            event=row.type,
                            data=json.dumps(row.data, ensure_ascii=False),
                        )
                    if not rows:
                        await self._hub.wait(wake)
            finally:
                self._hub.unsubscribe(draft_id, wake)

        return stream()

    async def sweep_events(self, *, older_than_s: int = 86_400) -> int:
        async with self._engine.begin() as conn:
            return await repo.delete_old_events(conn, older_than_s=older_than_s)


def _clean_text(text: str) -> str:
    text = text.replace("\x00", "").strip()
    if not text:
        raise Invalid("Say what you'd like", field="text")
    if len(text) > MAX_TEXT_CHARS:
        raise AppError(
            f"At most {MAX_TEXT_CHARS} characters",
            code="VALIDATION_ERROR",
            status=422,
            field="text",
        )
    return text
