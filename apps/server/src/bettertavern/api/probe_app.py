"""M0 探针接口（开发用，ENABLE_PROBE_ENDPOINTS 控制）。

作为一个小的 Starlette 子应用挂在 /v1/probe 下，不进 OpenAPI 契约：
- POST /v1/probe/streams                创建一条模拟的长流，201
- GET  /v1/probe/streams/{id}/events    订阅 SSE，支持 Last-Event-ID
                                        （请求头，或 last_event_id 查询参数）
- GET  /v1/probe/streams/{id}           轮询状态；结束后带全文，用来核对拼接结果
                                        （也是 SSE 不可用时的轮询降级入口）
- GET  /v1/probe/time                   服务端时间，客户端据此估算时钟偏差、计算延迟
"""

from __future__ import annotations

import asyncio
import json

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from bettertavern.services.probe_service import (
    ProbeConfig,
    ProbeConfigError,
    ProbeService,
    now_ms,
)

from .errors import problem
from .sse import event_stream_body, parse_last_event_id, sse_response


def create_probe_app(
    service: ProbeService,
    *,
    keepalive: float = 15.0,
    shutdown: asyncio.Event | None = None,
) -> Starlette:
    async def create_stream(request: Request) -> Response:
        raw = await request.body()
        try:
            data = json.loads(raw) if raw.strip() else {}
            if not isinstance(data, dict):
                raise ProbeConfigError("请求体应该是 JSON 对象")
            record = await service.start(ProbeConfig.from_mapping(data))
        except (json.JSONDecodeError, ProbeConfigError) as exc:
            return problem(422, "VALIDATION_ERROR", "参数错误", detail=str(exc))
        base = f"/v1/probe/streams/{record.stream_id}"
        return JSONResponse(
            {
                **record.to_json(include_text=False),
                "events_url": f"{base}/events",
                "status_url": base,
            },
            status_code=201,
        )

    async def stream_events(request: Request) -> Response:
        stream_id = request.path_params["stream_id"]
        stream = service.stream(stream_id)
        if stream is None:
            return problem(404, "NOT_FOUND", "事件流不存在或缓冲已过期，请改用轮询")
        last_id = request.headers.get("last-event-id") or request.query_params.get("last_event_id")
        after = parse_last_event_id(last_id, stream_id)
        body = event_stream_body(
            stream.subscribe(after), keepalive=keepalive, stop=shutdown, resumed_from=after
        )
        return sse_response(body)

    async def stream_status(request: Request) -> Response:
        record = service.record(request.path_params["stream_id"])
        if record is None:
            return problem(404, "NOT_FOUND", "探针不存在")
        return JSONResponse(record.to_json(include_text=record.status == "completed"))

    async def server_time(request: Request) -> Response:
        return JSONResponse({"server_time_ms": now_ms()})

    return Starlette(
        routes=[
            Route("/streams", create_stream, methods=["POST"]),
            Route("/streams/{stream_id}/events", stream_events, methods=["GET"]),
            Route("/streams/{stream_id}", stream_status, methods=["GET"]),
            Route("/time", server_time, methods=["GET"]),
        ]
    )
