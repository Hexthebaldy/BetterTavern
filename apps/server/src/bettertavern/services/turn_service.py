"""回合：提交行动（幂等、租约）、详情、历史、取消，以及回合事件流（实时缓冲或快照）。

提交行动在一个事务里完成：锁 playthroughs 行 → 幂等键 → 故事是否已完结 → 租约 → 父回合校验
→ 解析行动 → 插入回合并领租约。到这里就返回 201，生成交给后台的 TurnRunner，与客户端连接无关。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.turn import (
    ActionError,
    TurnStatus,
    options_from_json,
    resolve_action,
)
from bettertavern.infra.db.repositories import story as repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.runtime.events.buffer import EventBufferRegistry, StreamEvent
from bettertavern.runtime.ports import TurnHeader
from bettertavern.runtime.runner import TurnRunnerPool

from .errors import AppError, Conflict, Invalid, NotFound
from .route_service import RouteService
from .views import TurnView

log = structlog.get_logger(__name__)

MAX_IDEMPOTENCY_KEY = 128
TERMINAL = {
    TurnStatus.REPLIED.value,
    TurnStatus.COMMITTED.value,
    TurnStatus.FAILED.value,
    TurnStatus.ARCHIVED.value,
}


@dataclass(frozen=True, slots=True)
class ActionInput:
    source: str
    text: str | None = None
    option_id: str | None = None


def header_for(pt: repo.PlaythroughRow, turn: repo.TurnRow, user_id: str) -> TurnHeader:
    return TurnHeader(
        turn_id=turn.id,
        playthrough_id=pt.id,
        user_id=user_id,
        seq=turn.seq,
        attempt=turn.attempt,
        epoch=turn.timeline_epoch,
        status=turn.status,
        world_ready=pt.status != "building",
        language=pt.language,
    )


def ensure_not_ended(pt: repo.PlaythroughRow) -> None:
    if pt.status == "ended":
        raise Conflict("This story has ended and can't continue", code="STORY_ENDED")


def request_hash(playthrough_id: str, parent_turn_id: str | None, action: ActionInput) -> str:
    payload = json.dumps(
        {
            "playthrough_id": playthrough_id,
            "parent_turn_id": parent_turn_id,
            "action": {"source": action.source, "text": action.text, "option_id": action.option_id},
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


class TurnService:
    def __init__(
        self,
        engine: AsyncEngine,
        routes: RouteService,
        runners: TurnRunnerPool,
        buffers: EventBufferRegistry,
        *,
        lease_ttl_s: float,
        instance_id: str,
        poll_interval: float = 1.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._engine = engine
        self._routes = routes
        self._runners = runners
        self._buffers = buffers
        self._lease_ttl = lease_ttl_s
        self._instance = instance_id
        self._poll = poll_interval
        self._clock = clock

    # ---- 提交行动 ------------------------------------------------------------------------
    async def create(
        self,
        user_id: str,
        playthrough_id: str,
        *,
        parent_turn_id: str | None,
        action: ActionInput,
        idempotency_key: str | None,
    ) -> tuple[TurnView, bool]:
        """返回 (回合, 是否新建)。同一个幂等键且请求相同时返回已有回合。"""
        if not is_uuid(playthrough_id):
            raise NotFound("Playthrough not found")
        structlog.contextvars.bind_contextvars(playthrough_id=playthrough_id)
        if parent_turn_id is not None and not is_uuid(parent_turn_id):
            raise Invalid("Invalid parent_turn_id", field="parent_turn_id")
        if idempotency_key is not None and not (0 < len(idempotency_key) <= MAX_IDEMPOTENCY_KEY):
            raise Invalid("Invalid Idempotency-Key length", field="Idempotency-Key")
        digest = request_hash(playthrough_id, parent_turn_id, action)
        # 先看是否重复提交，免得为一次重放去解密凭据
        if idempotency_key is not None:
            existing = await self._replay(user_id, idempotency_key, digest)
            if existing is not None:
                # 同一个幂等键的重复提交（客户端重试）：返回已有的回合，不再生成
                log.info("turn.replayed", turn_id=existing.id, seq=existing.seq)
                return existing, False
        # 先确认归属再查路由：别人的游玩记录一律 404，不暴露“没配模型”之类的状态
        async with self._engine.connect() as conn:
            found_pt = await repo.get_playthrough(conn, user_id, playthrough_id)
        if found_pt is None:
            raise NotFound("Playthrough not found")
        ensure_not_ended(found_pt)
        if await self._routes.resolve(user_id, RouteTask.DIRECTOR, playthrough_id) is None:
            raise AppError(
                "No director model is set up yet. Add a key and choose a model in Settings",
                code="ROUTE_MISSING",
                status=409,
            )
        async with self._engine.begin() as conn:
            pt = await repo.get_playthrough(conn, user_id, playthrough_id, lock=True)
            if pt is None:
                raise NotFound("Playthrough not found")
            if idempotency_key is not None:
                found = await repo.get_idempotency_key(conn, user_id, idempotency_key)
                if found is not None:  # 与另一个并发请求撞上了：它已经提交
                    if found[0] != digest:
                        raise Invalid(
                            "The same Idempotency-Key was used with a different request",
                            code="IDEMPOTENCY_KEY_REUSED",
                        )
                    turn = await repo.get_turn(conn, found[1])
                    if turn is not None:
                        log.info("turn.replayed", turn_id=turn.id, seq=turn.seq)
                        return TurnView.of(turn), False
            # 加锁之前看过一次；这里再看一次，防止另一台设备刚好写完结局
            ensure_not_ended(pt)
            if pt.active_turn_id is not None:
                if await repo.lease_alive(conn, pt.id):
                    raise Conflict(
                        "The previous turn is still being written",
                        code="TURN_IN_PROGRESS",
                        active_turn_id=pt.active_turn_id,
                    )
                # 租约已过期：生成进程没了，先把那一轮标为失败
                log.warning("turn.lease_expired", count=1, turn_ids=[pt.active_turn_id])
                await repo.fail_turn(
                    conn, pt.active_turn_id, narrative="", error=repo.RUNNER_LOST_ERROR
                )
                await repo.release_lease(conn, pt.id, pt.active_turn_id)
            if pt.head_turn_id != parent_turn_id:
                raise Conflict(
                    "The story has moved on; refresh first",
                    code="STALE_PARENT",
                    head_turn_id=pt.head_turn_id,
                )
            parent = await repo.get_turn(conn, parent_turn_id) if parent_turn_id else None
            if action.source == "opening":
                if parent is not None:
                    raise Invalid(
                        "The opening can only be regenerated before there is one",
                        code="OPENING_EXISTS",
                    )
                seq = 0
            else:
                if parent is None:
                    raise Conflict("The opening isn't finished yet", code="OPENING_PENDING")
                seq = parent.seq + 1
            try:
                resolved = resolve_action(
                    action.source,
                    text=action.text,
                    option_id=action.option_id,
                    parent_options=options_from_json(parent.options) if parent else [],
                )
            except ActionError as exc:
                raise Invalid(exc.message, code=exc.code) from exc
            attempt = await repo.next_attempt(conn, pt.id, seq)
            turn = await repo.insert_turn(
                conn,
                playthrough_id=pt.id,
                seq=seq,
                parent_turn_id=parent_turn_id,
                attempt=attempt,
                epoch=pt.timeline_epoch,
                user_action=resolved.to_json(),
            )
            await repo.take_lease(conn, pt.id, turn.id, ttl_s=self._lease_ttl, owner=self._instance)
            if idempotency_key is not None:
                await repo.insert_idempotency_key(conn, user_id, idempotency_key, digest, turn.id)
        # 行动的文字不记，只记长度
        log.info(
            "turn.submitted",
            turn_id=turn.id,
            seq=seq,
            turn_attempt=attempt,
            source=action.source,
            text_chars=len(action.text) if action.text else None,
            idempotent=idempotency_key is not None,
        )
        self._runners.start(header_for(pt, turn, user_id))
        return TurnView.of(turn), True

    async def _replay(self, user_id: str, key: str, digest: str) -> TurnView | None:
        async with self._engine.connect() as conn:
            found = await repo.get_idempotency_key(conn, user_id, key)
            if found is None:
                return None
            if found[0] != digest:
                raise Invalid(
                    "The same Idempotency-Key was used with a different request",
                    code="IDEMPOTENCY_KEY_REUSED",
                )
            turn = await repo.get_turn(conn, found[1])
        return TurnView.of(turn) if turn is not None else None

    # ---- 读取 ---------------------------------------------------------------------------
    async def get(self, user_id: str, turn_id: str) -> TurnView:
        if not is_uuid(turn_id):
            raise NotFound("Turn not found")
        async with self._engine.connect() as conn:
            turn = await repo.get_user_turn(conn, user_id, turn_id)
        if turn is None:
            raise NotFound("Turn not found")
        return TurnView.of(turn)

    async def history(
        self, user_id: str, playthrough_id: str, *, after_seq: int, limit: int
    ) -> list[TurnView]:
        if not is_uuid(playthrough_id):
            raise NotFound("Playthrough not found")
        async with self._engine.connect() as conn:
            pt = await repo.get_playthrough(conn, user_id, playthrough_id)
            if pt is None:
                raise NotFound("Playthrough not found")
            rows = await repo.list_chain(conn, pt.id, after_seq=after_seq, limit=limit)
        return [TurnView.of(r) for r in rows]

    async def cancel(self, user_id: str, turn_id: str) -> TurnView:
        turn = await self.get(user_id, turn_id)
        log.info("turn.cancel_requested", turn_id=turn_id, status=turn.status)
        if turn.status != TurnStatus.GENERATING.value:
            return turn
        if not self._runners.cancel(turn_id, "user"):
            # 不在本进程（进程重启后）：租约到期后由清理任务标记失败
            raise Conflict(
                "This turn is running on another server instance and will stop on its own shortly",
                code="TURN_NOT_LOCAL",
            )
        return turn

    # ---- 事件流 -------------------------------------------------------------------------
    async def events(
        self, user_id: str, turn_id: str, *, after_seq: int
    ) -> AsyncIterator[StreamEvent]:
        """先校验归属。缓冲还在就实时订阅；缓冲已过期（或不在本进程）就等回合结束后一次给全。"""
        turn = await self.get(user_id, turn_id)
        stream = self._buffers.get(turn_id)
        if stream is not None:
            # backlog：续传时缓冲里已经有、要先补发的条数
            log.info(
                "sse.subscribe",
                mode="live",
                backlog=max(stream.last_seq - after_seq, 0),
                status=turn.status,
            )
            return stream.subscribe(after_seq)
        # 缓冲已过期或不在本进程：等回合结束后一次给全
        log.info("sse.subscribe", mode="snapshot", status=turn.status)
        return self._snapshot_events(user_id, turn)

    async def _snapshot_events(self, user_id: str, turn: TurnView) -> AsyncIterator[StreamEvent]:
        deadline = self._clock() + self._lease_ttl + 15.0
        while turn.status not in TERMINAL and self._clock() < deadline:
            await asyncio.sleep(self._poll)
            turn = await self.get(user_id, turn.id)
        seq = 0

        def event(name: str, data: dict[str, Any]) -> StreamEvent:
            nonlocal seq
            seq += 1
            return StreamEvent(turn.id, seq, name, json.dumps(data, ensure_ascii=False))

        if turn.status in (TurnStatus.REPLIED.value, TurnStatus.COMMITTED.value):
            yield event(
                "snapshot",
                {
                    "narrative": turn.narrative,
                    "options": turn.options,
                    "source": turn.options_source,
                },
            )
            yield event(
                "turn.completed",
                {
                    "turn": {
                        "id": turn.id,
                        "seq": turn.seq,
                        "attempt": turn.attempt,
                        "status": turn.status,
                        "narrative": turn.narrative,
                        "options": turn.options,
                        "options_source": turn.options_source,
                        "state_lag": turn.state_lag,
                    },
                    "usage": None,
                },
            )
            return
        error = turn.error or {
            "code": "RUNNER_LOST",
            "message": "Generation stopped unexpectedly, please try again",
            "retryable": True,
            "reason": None,
        }
        if turn.status == TurnStatus.ARCHIVED.value:
            error = {
                "code": "TURN_ARCHIVED",
                "message": "This turn was rolled back",
                "retryable": False,
                "reason": None,
            }
        if turn.narrative:
            yield event("snapshot", {"narrative": turn.narrative, "options": [], "source": None})
        yield event(
            "turn.failed",
            {
                "code": error.get("code", "UNKNOWN"),
                "message": error.get("message", ""),
                "retryable": bool(error.get("retryable", True)),
                "partial": bool(turn.narrative),
            },
        )
