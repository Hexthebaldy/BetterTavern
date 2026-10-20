"""游玩与回合：开局、提交行动（Idempotency-Key）、历史、详情、取消、回合事件流（SSE）、世界视图。"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, Header, Query, Request, Response, status
from starlette.responses import StreamingResponse

from bettertavern.api.deps import LimitersDep, ServicesDep, UserId, check_rate
from bettertavern.api.lifecycle import Shutdown
from bettertavern.api.schemas.story import (
    PlaythroughCreatedOut,
    PlaythroughDetailOut,
    PlaythroughIn,
    PlaythroughOut,
    PlaythroughPatchIn,
    RollbackIn,
    TurnCreatedOut,
    TurnIn,
    TurnListOut,
    TurnOut,
    WorldOut,
)
from bettertavern.api.sse import event_stream_body, parse_last_event_id, sse_response
from bettertavern.services.errors import Unavailable
from bettertavern.services.playthrough_service import NewPlaythrough
from bettertavern.services.turn_service import ActionInput

router = APIRouter(prefix="/v1", tags=["play"])


def events_url(turn_id: str) -> str:
    return f"/v1/turns/{turn_id}/events"


def _check_accepting(request: Request) -> None:
    shutdown: Shutdown | None = getattr(request.app.state, "shutdown", None)
    if shutdown is not None and shutdown.triggered:
        raise Unavailable(
            "The server is restarting, please try again shortly",
            retryable=True,
            headers={"Retry-After": "5"},
        )


@router.post("/playthroughs", status_code=status.HTTP_202_ACCEPTED)
async def create_playthrough(
    body: PlaythroughIn,
    request: Request,
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
) -> PlaythroughCreatedOut:
    _check_accepting(request)
    check_rate(limiters.turns, f"turns:{user_id}")
    pt, turn = await services.playthroughs.create(
        user_id,
        NewPlaythrough(
            scenario_id=body.scenario_id,
            protagonist_name=body.protagonist.name,
            protagonist_summary=body.protagonist.summary,
            title=body.title,
            preferences=body.preferences.model_dump(),
            language=body.language,
        ),
    )
    return PlaythroughCreatedOut(
        playthrough=PlaythroughOut.model_validate(pt),
        turn=TurnOut.model_validate(turn),
        events_url=events_url(turn.id),
    )


@router.get("/playthroughs")
async def list_playthroughs(user_id: UserId, services: ServicesDep) -> list[PlaythroughOut]:
    return [PlaythroughOut.model_validate(p) for p in await services.playthroughs.list(user_id)]


@router.get("/playthroughs/{playthrough_id}")
async def get_playthrough(
    playthrough_id: str, user_id: UserId, services: ServicesDep
) -> PlaythroughDetailOut:
    return PlaythroughDetailOut.model_validate(
        await services.playthroughs.get(user_id, playthrough_id)
    )


@router.patch("/playthroughs/{playthrough_id}")
async def rename_playthrough(
    playthrough_id: str, body: PlaythroughPatchIn, user_id: UserId, services: ServicesDep
) -> PlaythroughOut:
    return PlaythroughOut.model_validate(
        await services.playthroughs.rename(user_id, playthrough_id, body.title)
    )


@router.post("/playthroughs/{playthrough_id}/rollback")
async def rollback_playthrough(
    playthrough_id: str, body: RollbackIn, user_id: UserId, services: ServicesDep
) -> PlaythroughDetailOut:
    return PlaythroughDetailOut.model_validate(
        await services.playthroughs.rollback(user_id, playthrough_id, body.turn_id)
    )


@router.delete("/playthroughs/{playthrough_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playthrough(
    playthrough_id: str, user_id: UserId, services: ServicesDep
) -> Response:
    await services.playthroughs.delete(user_id, playthrough_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/playthroughs/{playthrough_id}/turns")
async def list_turns(
    playthrough_id: str,
    user_id: UserId,
    services: ServicesDep,
    after_seq: Annotated[int, Query(ge=-1)] = -1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> TurnListOut:
    turns = await services.turns.history(user_id, playthrough_id, after_seq=after_seq, limit=limit)
    return TurnListOut(turns=[TurnOut.model_validate(t) for t in turns])


@router.post("/playthroughs/{playthrough_id}/turns", status_code=status.HTTP_201_CREATED)
async def create_turn(
    playthrough_id: str,
    body: TurnIn,
    request: Request,
    response: Response,
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> TurnCreatedOut:
    _check_accepting(request)
    check_rate(limiters.turns, f"turns:{user_id}")
    turn, created = await services.turns.create(
        user_id,
        playthrough_id,
        parent_turn_id=body.parent_turn_id,
        action=ActionInput(
            source=body.action.source, text=body.action.text, option_id=body.action.option_id
        ),
        idempotency_key=idempotency_key,
    )
    if not created:  # 同一个 Idempotency-Key 的重放：返回已有的回合
        response.status_code = status.HTTP_200_OK
    return TurnCreatedOut(turn=TurnOut.model_validate(turn), events_url=events_url(turn.id))


@router.get("/playthroughs/{playthrough_id}/world")
async def get_world(
    playthrough_id: str,
    user_id: UserId,
    services: ServicesDep,
    reveal: bool = False,
) -> WorldOut:
    return WorldOut.model_validate(
        await services.playthroughs.world(user_id, playthrough_id, reveal=reveal)
    )


@router.get("/turns/{turn_id}")
async def get_turn(turn_id: str, user_id: UserId, services: ServicesDep) -> TurnOut:
    return TurnOut.model_validate(await services.turns.get(user_id, turn_id))


@router.post("/turns/{turn_id}/cancel")
async def cancel_turn(turn_id: str, user_id: UserId, services: ServicesDep) -> TurnOut:
    return TurnOut.model_validate(await services.turns.cancel(user_id, turn_id))


@router.get("/turns/{turn_id}/events", response_class=StreamingResponse)
async def turn_events(
    turn_id: str,
    request: Request,
    user_id: UserId,
    services: ServicesDep,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    after = parse_last_event_id(last_event_id, turn_id)
    # 事件流的日志（sse.open / sse.close）带上回合编号；推送在请求派生的任务里跑，会继承这个绑定
    structlog.contextvars.bind_contextvars(turn_id=turn_id)
    events = await services.turns.events(user_id, turn_id, after_seq=after)
    shutdown: Shutdown | None = getattr(request.app.state, "shutdown", None)
    return sse_response(
        event_stream_body(
            events,
            stop=shutdown.event if shutdown is not None else None,
            resumed_from=after,
        )
    )
