"""把一个回合的日志记录拼成时间线（瀑布图的数据）。纯函数，不读文件、不连数据库。

每一行（lane）是一类事情，行里是若干时间条（Span）和时间点（Marker）：
- request：提交请求、取消请求等 HTTP 请求（不含事件流，事件流单独成行）；
- turn：回合从开始到提交或失败的整段；
- world：开局时搭建世界；
- steps：等上一轮的状态、组装上下文、检查格式、补选项、保存；
- model：调模型的每一次尝试（等第一个字 / 吐字 / 失败）、重试前的等待、等并发槽位；
- sse:1、sse:2……：手机的每一条推送连接，从建立到结束。

kind、lane、status 都是英文代号，网页负责翻译成中文和配色。时间都是毫秒时间戳。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .logstore import Entry

_EVENT_STREAM = "/v1/turns/{turn_id}/events"


@dataclass
class Span:
    lane: str
    kind: str
    start: float
    end: float
    status: str = "ok"  # ok / warn / error / running
    fields: dict[str, Any] = field(default_factory=dict)
    ref: int | None = None  # 结束那条记录的 n


@dataclass
class Marker:
    lane: str
    kind: str
    at: float
    status: str = "ok"
    fields: dict[str, Any] = field(default_factory=dict)
    ref: int | None = None


@dataclass
class Timeline:
    origin: float | None
    end: float | None
    spans: list[Span]
    markers: list[Marker]

    def to_json(self) -> dict[str, Any]:
        return {
            "origin": self.origin,
            "end": self.end,
            "spans": [asdict(s) for s in self.spans],
            "markers": [asdict(m) for m in self.markers],
        }


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _before(entry: Entry) -> float:
    """带 duration_ms 的记录在步骤结束时写，开始时间往前推"""
    duration = _num(entry.get("duration_ms"))
    return entry.t - duration if duration is not None else entry.t


def _pick(entry: Entry, *keys: str) -> dict[str, Any]:
    return {k: entry.get(k) for k in keys if entry.get(k) is not None}


@dataclass
class _Attempt:
    start: float
    number: int
    fields: dict[str, Any]
    first_token: float | None = None


def build_timeline(entries: list[Entry], *, running: bool = False) -> Timeline:
    """entries 按时间排好。running 表示回合还在生成：没结束的条一直画到最后一条记录"""
    spans: list[Span] = []
    markers: list[Marker] = []
    if not entries:
        return Timeline(None, None, spans, markers)
    last_t = entries[-1].t
    open_status = "running" if running else "warn"

    turn_start: float | None = None
    world_start: float | None = None
    attempt: _Attempt | None = None
    retry_wait: Span | None = None
    sse_open: dict[str, tuple[float, int, dict[str, Any]]] = {}
    sse_count = 0
    pending_subscribe: dict[str, dict[str, Any]] = {}
    steps_end: float | None = None
    turn_end: float | None = None

    def close_attempt(end: float, ok: bool, ref: int, extra: dict[str, Any]) -> None:
        nonlocal attempt, steps_end
        if attempt is None:
            return
        fields = {**attempt.fields, **extra, "attempt": attempt.number}
        status = "ok" if ok else "error"
        if attempt.first_token is not None:
            spans.append(
                Span(
                    "model", "provider_wait", attempt.start, attempt.first_token, "ok", fields, ref
                )
            )
            spans.append(
                Span("model", "provider_stream", attempt.first_token, end, status, fields, ref)
            )
        else:
            kind = "provider_stream" if ok else "provider_failed"
            spans.append(Span("model", kind, attempt.start, end, status, fields, ref))
        steps_end = max(steps_end or end, end)
        attempt = None

    for e in entries:
        event = e.event
        if event == "http.request":
            if e.get("route") == _EVENT_STREAM:
                continue  # 事件流的连接在 sse 行里画
            status_code = _num(e.get("status"))
            status = "ok" if status_code is not None and status_code < 400 else "error"
            if e.get("aborted"):
                status = "warn"
            spans.append(
                Span(
                    "request",
                    "http",
                    _before(e),
                    e.t,
                    status,
                    _pick(
                        e,
                        "method",
                        "route",
                        "path",
                        "status",
                        "request_id",
                        "error_code",
                        "duration_ms",
                    ),
                    e.n,
                )
            )
        elif event in ("turn.replayed", "turn.cancel_requested"):
            markers.append(
                Marker("request", event.split(".", 1)[1], e.t, "ok", _pick(e, "status"), e.n)
            )
        elif event == "turn.started":
            turn_start = e.t
        elif event in ("turn.committed", "turn.failed"):
            ok = event == "turn.committed"
            start = turn_start if turn_start is not None else _before(e)
            spans.append(
                Span(
                    "turn",
                    "turn",
                    start,
                    e.t,
                    "ok" if ok else "error",
                    _pick(
                        e,
                        "code",
                        "message",
                        "retryable",
                        "partial",
                        "cancel_reason",
                        "duration_ms",
                        "options_source",
                    ),
                    e.n,
                )
            )
            turn_end = e.t
            if ok:
                commit_start = steps_end if steps_end is not None and steps_end <= e.t else e.t
                spans.append(Span("steps", "commit", commit_start, e.t, "ok", {}, e.n))
            close_attempt(e.t, ok, e.n, {})
        elif event in ("turn.commit_rejected", "turn.crashed", "turn.lease_expired"):
            markers.append(Marker("turn", event.split(".", 1)[1], e.t, "error", {}, e.n))
        elif event == "world.build.started":
            world_start = e.t
        elif event == "world.build.done":
            start = world_start if world_start is not None else _before(e)
            minimal = e.get("source") == "minimal"
            spans.append(
                Span(
                    "world",
                    "world",
                    start,
                    e.t,
                    "warn" if minimal else "ok",
                    _pick(
                        e, "source", "entities", "provider", "model", "error_class", "duration_ms"
                    ),
                    e.n,
                )
            )
            steps_end = e.t
        elif event == "turn.barrier_waited":
            status = "warn" if e.get("lag") else "ok"
            spans.append(
                Span(
                    "steps", "barrier", _before(e), e.t, status, _pick(e, "lag", "duration_ms"), e.n
                )
            )
        elif event == "context.assembled":
            markers.append(
                Marker(
                    "steps",
                    "context",
                    e.t,
                    "ok",
                    _pick(
                        e,
                        "window",
                        "estimated_tokens",
                        "usage_ratio",
                        "dropped_turns",
                        "prompt_hash",
                        "model",
                    ),
                    e.n,
                )
            )
        elif event == "provider.slot_wait":
            spans.append(
                Span("model", "slot_wait", _before(e), e.t, "warn", _pick(e, "duration_ms"), e.n)
            )
        elif event == "provider.slot_timeout":
            spans.append(
                Span("model", "slot_wait", _before(e), e.t, "error", _pick(e, "duration_ms"), e.n)
            )
        elif event == "provider.request":
            if retry_wait is not None:
                retry_wait.end = e.t
                retry_wait = None
            attempt = _Attempt(
                start=e.t,
                number=int(_num(e.get("attempt")) or 1),
                fields=_pick(e, "provider", "model", "route_id", "estimated_tokens"),
            )
        elif event == "provider.first_token":
            if attempt is not None:
                attempt.first_token = e.t
        elif event == "provider.retry":
            close_attempt(e.t, False, e.n, _pick(e, "error_class", "status"))
            wait = (_num(e.get("retry_in_s")) or 0.0) * 1000
            retry_wait = Span(
                "model",
                "retry_wait",
                e.t,
                e.t + wait,
                "warn",
                _pick(e, "error_class", "status", "retry_in_s"),
                e.n,
            )
            spans.append(retry_wait)
        elif event == "provider.response":
            close_attempt(
                e.t,
                True,
                e.n,
                _pick(
                    e,
                    "ttft_ms",
                    "finish_reason",
                    "prompt_tokens",
                    "cached_tokens",
                    "completion_tokens",
                    "reasoning_tokens",
                    "streamed_chars",
                ),
            )
        elif event == "provider.failed":
            close_attempt(
                e.t, False, e.n, _pick(e, "error_class", "status", "partial", "streamed_chars")
            )
        elif event in ("turn.fallback", "turn.context_overflow_retry"):
            markers.append(
                Marker(
                    "model",
                    event.split(".", 1)[1],
                    e.t,
                    "warn",
                    _pick(e, "error_class", "from_model", "to_provider", "to_model", "window"),
                    e.n,
                )
            )
        elif event == "director.parse":
            stage = e.get("stage")
            status = (
                "ok"
                if stage in ("ok", "salvaged", "ending")
                else ("error" if stage == "narrative_missing" else "warn")
            )
            markers.append(
                Marker(
                    "steps",
                    "parse",
                    e.t,
                    status,
                    _pick(e, "stage", "options", "repairs", "notes", "rewritten"),
                    e.n,
                )
            )
            steps_end = max(steps_end or e.t, e.t)
        elif event in ("options.repair", "options.repair_failed"):
            ok = event == "options.repair"
            spans.append(
                Span(
                    "steps",
                    "repair",
                    _before(e),
                    e.t,
                    "ok" if ok else "warn",
                    _pick(e, "model", "existing", "produced", "error_class", "duration_ms"),
                    e.n,
                )
            )
            steps_end = max(steps_end or e.t, e.t)
        elif event == "sse.subscribe":
            rid = e.get("request_id")
            if isinstance(rid, str):
                pending_subscribe[rid] = _pick(e, "mode", "backlog", "status")
        elif event == "sse.open":
            rid = e.get("request_id")
            key = rid if isinstance(rid, str) else f"n{e.n}"
            sse_count += 1
            sse_open[key] = (
                e.t,
                sse_count,
                {**pending_subscribe.pop(key, {}), **_pick(e, "resumed_from", "request_id")},
            )
        elif event == "sse.close":
            rid = e.get("request_id")
            key = rid if isinstance(rid, str) else ""
            opened = sse_open.pop(key, None)
            if opened is None:
                sse_count += 1
                opened = (_before(e), sse_count, _pick(e, "request_id"))
            start, number, fields = opened
            reason = e.get("reason")
            # 回合结束前客户端就断开了：手机断线（之后会带 Last-Event-ID 续传）
            dropped = reason == "client_gone" and (turn_end is None or e.t < turn_end - 1)
            status = (
                "ok"
                if reason == "completed" or (reason == "client_gone" and not dropped)
                else "warn"
            )
            spans.append(
                Span(
                    f"sse:{number}",
                    "sse",
                    start,
                    e.t,
                    status,
                    {
                        **fields,
                        **_pick(e, "reason", "events_sent", "last_seq", "duration_ms"),
                        "dropped": dropped,
                    },
                    e.n,
                )
            )

    # 没结束的：一直画到最后一条记录
    if turn_start is not None and turn_end is None:
        spans.append(Span("turn", "turn", turn_start, last_t, open_status, {}, None))
    if world_start is not None and not any(s.kind == "world" for s in spans):
        spans.append(Span("world", "world", world_start, last_t, open_status, {}, None))
    if attempt is not None:
        kind = "provider_stream" if attempt.first_token is not None else "provider_wait"
        start = attempt.first_token if attempt.first_token is not None else attempt.start
        if attempt.first_token is not None:
            spans.append(
                Span(
                    "model",
                    "provider_wait",
                    attempt.start,
                    attempt.first_token,
                    "ok",
                    attempt.fields,
                )
            )
        spans.append(
            Span(
                "model",
                kind,
                start,
                last_t,
                open_status,
                {**attempt.fields, "attempt": attempt.number},
            )
        )
    for start, number, fields in sse_open.values():
        spans.append(Span(f"sse:{number}", "sse", start, last_t, open_status, fields))

    times = [s.start for s in spans] + [m.at for m in markers] + [e.t for e in entries]
    ends = [s.end for s in spans] + [m.at for m in markers] + [last_t]
    spans.sort(key=lambda s: (s.start, s.end))
    markers.sort(key=lambda m: m.at)
    return Timeline(origin=min(times), end=max(ends), spans=spans, markers=markers)
