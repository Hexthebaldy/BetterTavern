"""回合时间线与问题检测：用一串模拟的日志记录拼时间条、挑问题。"""

from __future__ import annotations

from typing import Any

from bettertavern.vis.issues import recent_problems, turn_issues
from bettertavern.vis.logstore import Entry
from bettertavern.vis.timeline import build_timeline
from bettertavern.vis.views import filter_logs, requests, turns_by_request

T0 = 1_000_000.0


def entries(*items: tuple[float, str, dict[str, Any]]) -> list[Entry]:
    out = []
    for n, (ms, event, fields) in enumerate(items, start=1):
        data = {"event": event, "level": fields.pop("level", "info"), **fields}
        out.append(Entry(n=n, t=T0 + ms, source="api", data=data, line=str(data)))
    return out


SUBMIT = "/v1/playthroughs/{playthrough_id}/turns"
EVENTS = "/v1/turns/{turn_id}/events"


def a_turn_with_one_context_overflow_retry() -> list[Entry]:
    return entries(
        (0, "turn.submitted", {"request_id": "r1", "turn_id": "T"}),
        (5, "turn.started", {"request_id": "r1", "turn_id": "T"}),
        (
            12,
            "http.request",
            {"request_id": "r1", "route": SUBMIT, "status": 201, "duration_ms": 30},
        ),
        (20, "context.assembled", {"turn_id": "T", "usage_ratio": 0.9, "estimated_tokens": 9000}),
        (25, "provider.request", {"turn_id": "T", "model": "m"}),
        (
            425,
            "provider.failed",
            {
                "turn_id": "T",
                "error_class": "context_overflow",
                "status": 400,
                "level": "warning",
            },
        ),
        (426, "turn.context_overflow_retry", {"turn_id": "T", "window": 8000, "level": "warning"}),
        (428, "context.assembled", {"turn_id": "T", "usage_ratio": 0.85, "estimated_tokens": 6800}),
        (2430, "provider.request", {"turn_id": "T", "model": "m"}),
        (8430, "provider.first_token", {"turn_id": "T", "ttft_ms": 8405}),
        (9000, "sse.subscribe", {"request_id": "s1", "turn_id": "T", "mode": "live", "backlog": 3}),
        (9001, "sse.open", {"request_id": "s1", "turn_id": "T", "resumed_from": 0}),
        (
            9500,
            "sse.close",
            {"request_id": "s1", "turn_id": "T", "reason": "client_gone", "events_sent": 4},
        ),
        (9800, "sse.open", {"request_id": "s2", "turn_id": "T", "resumed_from": 4}),
        (
            12000,
            "provider.response",
            {"turn_id": "T", "prompt_tokens": 9000, "cached_tokens": 900, "completion_tokens": 300},
        ),
        (
            12010,
            "director.parse",
            {"turn_id": "T", "stage": "repaired", "repairs": ["<options> 没有闭合"]},
        ),
        (12050, "turn.committed", {"turn_id": "T", "duration_ms": 12045}),
        (
            12100,
            "sse.close",
            {"request_id": "s2", "turn_id": "T", "reason": "completed", "events_sent": 9},
        ),
        (
            12101,
            "http.request",
            {"request_id": "s2", "route": EVENTS, "status": 200, "duration_ms": 2300},
        ),
    )


def test_spans_follow_the_turn_step_by_step() -> None:
    timeline = build_timeline(a_turn_with_one_context_overflow_retry())
    kinds = [(s.lane, s.kind, s.status) for s in timeline.spans]
    assert ("request", "http", "ok") in kinds
    assert ("turn", "turn", "ok") in kinds
    model = [
        (s.kind, s.status, s.fields.get("attempt")) for s in timeline.spans if s.lane == "model"
    ]
    # 超窗后重新装配再请求一次：第几次请求按这一回合里 provider.request 出现的顺序数
    assert model == [
        ("provider_failed", "error", 1),
        ("provider_wait", "ok", 2),
        ("provider_stream", "ok", 2),
    ]
    failed = next(s for s in timeline.spans if s.kind == "provider_failed")
    assert (failed.start, failed.end) == (T0 + 25, T0 + 425)
    stream = next(s for s in timeline.spans if s.kind == "provider_stream")
    assert stream.fields["completion_tokens"] == 300
    sse = [
        (s.lane, s.fields.get("dropped"), s.fields.get("backlog"))
        for s in timeline.spans
        if s.kind == "sse"
    ]
    assert sse == [("sse:1", True, 3), ("sse:2", False, None)]
    assert not any(s.lane == "request" and s.fields.get("route") == EVENTS for s in timeline.spans)
    assert [m.kind for m in timeline.markers] == [
        "context",
        "context_overflow_retry",
        "context",
        "parse",
    ]
    assert timeline.origin == T0 - 18  # 提交请求从 12-30 毫秒开始
    commit = next(s for s in timeline.spans if s.kind == "commit")
    assert (commit.start, commit.end) == (T0 + 12010, T0 + 12050)


def test_unfinished_spans_run_to_the_last_entry_while_generating() -> None:
    items = a_turn_with_one_context_overflow_retry()[:10]
    timeline = build_timeline(items, running=True)
    open_ones = [(s.kind, s.status, s.end) for s in timeline.spans if s.status == "running"]
    assert ("turn", "running", T0 + 8430) in open_ones
    assert ("provider_stream", "running", T0 + 8430) in open_ones


def test_issues_point_out_what_went_wrong() -> None:
    items = a_turn_with_one_context_overflow_retry()
    timeline = build_timeline(items)
    issues = turn_issues(items, timeline, turn={"status": "committed", "seq": 5})
    codes = [(i.severity, i.code) for i in issues]
    assert ("error", "provider_failed") in codes
    assert ("warn", "context_overflow") in codes
    assert ("warn", "slow_first_token") in codes
    assert ("warn", "parse_repaired") in codes
    assert ("info", "context_tight") in codes
    assert ("info", "low_cache") in codes
    assert ("info", "sse_dropped") in codes
    overflow = next(i for i in issues if i.code == "context_overflow")
    assert overflow.fields == {"window": 8000}
    severities = [i.severity for i in issues]
    assert severities == sorted(severities, key=["error", "warn", "info"].index)


def test_failed_turn_is_reported_first() -> None:
    items = entries(
        (0, "turn.started", {"turn_id": "T"}),
        (10, "provider.request", {"turn_id": "T"}),
        (
            500,
            "provider.failed",
            {"turn_id": "T", "error_class": "auth", "status": 401, "level": "warning"},
        ),
        (
            510,
            "turn.failed",
            {
                "turn_id": "T",
                "code": "CREDENTIAL_INVALID",
                "message": "密钥无效",
                "level": "warning",
            },
        ),
    )
    timeline = build_timeline(items)
    assert next(s for s in timeline.spans if s.kind == "turn").status == "error"
    issues = turn_issues(items, timeline, turn={"status": "failed", "seq": 3})
    assert issues[0].code == "turn_failed"
    assert issues[0].fields["code"] == "CREDENTIAL_INVALID"


def test_turn_known_only_to_the_database_says_logs_are_missing() -> None:
    issues = turn_issues([], build_timeline([]), turn={"status": "committed", "seq": 1})
    assert [i.code for i in issues] == ["no_logs"]


def test_request_list_filters_and_links_turns() -> None:
    items = a_turn_with_one_context_overflow_retry() + entries(
        (
            20000,
            "http.request",
            {"request_id": "x", "path": "/v1/me", "status": 500, "duration_ms": 5},
        ),
        (
            20001,
            "http.request",
            {"request_id": "h", "path": "/health", "status": 200, "duration_ms": 1},
        ),
        (
            20002,
            "http.request",
            {"request_id": "y", "path": "/v1/scenarios", "status": 200, "duration_ms": 3100},
        ),
    )
    links = turns_by_request(items)
    everything = requests(items, turns_of=links)
    assert [r["request_id"] for r in everything] == ["y", "x", "s2", "r1"]
    assert everything[-1]["turn_ids"] == ["T"]
    assert [r["request_id"] for r in requests(items, kind="failed")] == ["x"]
    assert [r["request_id"] for r in requests(items, kind="slow")] == ["y"]  # 事件流的长连接不算慢


def test_raw_log_filters() -> None:
    items = a_turn_with_one_context_overflow_retry()
    assert [e.event for e in filter_logs(items, level="warning")] == [
        "provider.failed",
        "turn.context_overflow_retry",
    ]
    assert len(filter_logs(items, ident="s")) == 6  # 单号开头匹配：s1 三条、s2 三条
    assert [e.n for e in filter_logs(items, after=17)] == [18, 19]
    assert [e.event for e in filter_logs(items, q="REPAIRED")] == ["director.parse"]


def test_recent_problems_group_by_event() -> None:
    items = entries(
        (0, "provider.failed", {"level": "warning", "error_class": "rate_limit"}),
        (5, "provider.failed", {"level": "warning", "error_class": "timeout"}),
        (6, "http.error", {"level": "error"}),
        (7, "turn.committed", {}),
    )
    groups = recent_problems(items, since=T0)
    assert [(g.event, g.count) for g in groups] == [("http.error", 1), ("provider.failed", 2)]
    assert groups[1].sample["error_class"] == "timeout"
