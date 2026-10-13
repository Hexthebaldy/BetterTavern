"""探针接口的端到端测试：真实 HTTP 连接、SSE、断线后用 Last-Event-ID 续传。"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator

import httpx
import pytest

from bettertavern.api.probe_app import create_probe_app
from bettertavern.providers.sse_parser import SseDecoder, SseEvent
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.services.probe_service import ProbeConfig, ProbeConfigError, probe_text
from bettertavern.services.probe_service import ProbeService as Service
from tests.fakes.asgi_server import AsgiServer

pytestmark = pytest.mark.anyio


@pytest.fixture(scope="module")
def server() -> Iterator[AsgiServer]:
    service = Service(EventBufferRegistry())
    running = AsgiServer(create_probe_app(service, keepalive=0.2)).start()
    try:
        yield running
    finally:
        running.stop()


async def read_events(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    limit: int | None = None,
) -> list[SseEvent]:
    decoder = SseDecoder()
    events: list[SseEvent] = []
    async with client.stream("GET", url, headers=headers) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["x-accel-buffering"] == "no"
        async for chunk in response.aiter_bytes():
            events += decoder.feed(chunk)
            if limit is not None and len(events) >= limit:
                break  # 模拟断网：直接关闭连接
            if events and events[-1].event == "turn.completed":
                break
    return events


def text_of(events: list[SseEvent]) -> str:
    return "".join(json.loads(e.data)["text"] for e in events if e.event == "narrative.delta")


async def test_full_stream_and_resume_after_disconnect(server: AsgiServer) -> None:
    async with httpx.AsyncClient(base_url=server.base_url, timeout=10) as client:
        created = await client.post(
            "/streams", json={"duration_s": 1, "events_per_second": 100, "chars_per_event": 5}
        )
        assert created.status_code == 201
        info = created.json()
        stream_id = info["stream_id"]
        assert info["events_url"] == f"/v1/probe/streams/{stream_id}/events"

        first = await read_events(client, f"/streams/{stream_id}/events", limit=12)
        last_id = first[-1].id
        assert last_id is not None and last_id.startswith(stream_id + ":")
        rest = await read_events(
            client, f"/streams/{stream_id}/events", headers={"Last-Event-ID": last_id}
        )
        events = first + rest
        seqs = [int(e.id.rsplit(":", 1)[1]) for e in events if e.id]
        assert seqs == list(range(1, len(seqs) + 1))  # 续传后不重不漏
        assert events[0].event == "turn.created"
        completed = json.loads(events[-1].data)
        assert events[-1].event == "turn.completed"

        status = (await client.get(f"/streams/{stream_id}")).json()
        assert status["status"] == "completed"
        assert text_of(events) == status["text"]
        assert hashlib.sha256(status["text"].encode()).hexdigest() == completed["sha256"]


async def test_query_parameter_resume_and_replay_after_completion(server: AsgiServer) -> None:
    async with httpx.AsyncClient(base_url=server.base_url, timeout=10) as client:
        stream_id = (
            await client.post("/streams", json={"duration_s": 1, "events_per_second": 200})
        ).json()["stream_id"]
        full = await read_events(client, f"/streams/{stream_id}/events")
        # 流结束后仍可在保留期内从任意位置重放
        tail = await read_events(
            client, f"/streams/{stream_id}/events?last_event_id={stream_id}:{len(full) - 2}"
        )
        assert [e.event for e in tail] == [e.event for e in full[-2:]]


async def test_keepalive_comments_are_sent(server: AsgiServer) -> None:
    async with httpx.AsyncClient(base_url=server.base_url, timeout=10) as client:
        stream_id = (
            await client.post(
                "/streams", json={"duration_s": 2, "events_per_second": 1, "chars_per_event": 1}
            )
        ).json()["stream_id"]
        decoder = SseDecoder()
        async with client.stream("GET", f"/streams/{stream_id}/events") as response:
            async for chunk in response.aiter_bytes():
                decoder.feed(chunk)
                if decoder.comments:
                    break
        assert decoder.comments >= 1


async def test_errors(server: AsgiServer) -> None:
    async with httpx.AsyncClient(base_url=server.base_url, timeout=10) as client:
        missing = await client.get("/streams/nope/events")
        assert missing.status_code == 404
        assert missing.headers["content-type"] == "application/problem+json"
        assert missing.json()["code"] == "NOT_FOUND"
        bad = await client.post("/streams", json={"duration_s": 99999})
        assert bad.status_code == 422
        assert (await client.post("/streams", content=b"[1]")).status_code == 422
        server_time = (await client.get("/time")).json()["server_time_ms"]
        assert server_time > 1_700_000_000_000


def test_probe_text_is_deterministic_and_has_four_byte_chars() -> None:
    text = probe_text(500)
    assert len(text) >= 500
    assert text == probe_text(500)
    assert any(len(ch.encode()) == 4 for ch in text)


def test_config_validation() -> None:
    assert ProbeConfig.from_mapping(None).total_chars == 180 * 20 * 8
    with pytest.raises(ProbeConfigError):
        ProbeConfig.from_mapping({"chars_per_event": 0})
    with pytest.raises(ProbeConfigError):
        ProbeConfig.from_mapping({"speed": 1})
    with pytest.raises(ProbeConfigError):
        ProbeConfig.from_mapping({"duration_s": "fast"})
