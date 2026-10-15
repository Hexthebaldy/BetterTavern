"""从日志记录里整理出网页要的几种列表。纯函数。

- requests：手机发来的请求，一个请求一行（来自访问日志 http.request），可以只看失败的或慢的；
- filter_logs：原始日志的筛选（级别、关键字、编号、游标）；
- log_metrics：概览页里来自日志的几个数（重试、断线、服务端错误）。
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from .logstore import Entry, level_at_least

SLOW_REQUEST_MS = 2_000
_HIDDEN_ROUTES = frozenset({"/health", "/ready"})
_ID_KEYS = ("request_id", "turn_id", "playthrough_id", "job_id")


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def request_row(entry: Entry, turn_ids: list[str]) -> dict[str, Any]:
    keys = (
        "method",
        "path",
        "route",
        "status",
        "duration_ms",
        "request_id",
        "user_ref",
        "error_code",
    )
    row = {k: entry.get(k) for k in keys}
    row.update(
        {
            "n": entry.n,
            "t": entry.t,
            "aborted": bool(entry.get("aborted")),
            "client_version": entry.get("client_version"),
            "turn_ids": turn_ids,
        }
    )
    return row


def is_failed(entry: Entry) -> bool:
    status = _num(entry.get("status"))
    return bool(entry.get("aborted")) or status is None or status >= 400


def is_slow(entry: Entry) -> bool:
    duration = _num(entry.get("duration_ms"))
    # 事件流本来就是长连接，不算慢
    return (
        duration is not None
        and duration >= SLOW_REQUEST_MS
        and not str(entry.get("route", "")).endswith("/events")
    )


def requests(
    entries: list[Entry],
    *,
    kind: str = "all",
    turns_of: dict[str, list[str]] | None = None,
    limit: int = 300,
) -> list[dict[str, Any]]:
    """新的在前。kind：all、failed、slow"""
    rows: list[dict[str, Any]] = []
    for entry in reversed(entries):
        if entry.event != "http.request" or entry.get("path") in _HIDDEN_ROUTES:
            continue
        if kind == "failed" and not is_failed(entry):
            continue
        if kind == "slow" and not is_slow(entry):
            continue
        rid = entry.get("request_id")
        rows.append(
            request_row(entry, (turns_of or {}).get(rid, []) if isinstance(rid, str) else [])
        )
        if len(rows) >= limit:
            break
    return rows


def turns_by_request(entries: list[Entry]) -> dict[str, list[str]]:
    """请求单号 → 这个请求涉及的回合"""
    found: dict[str, list[str]] = {}
    for entry in entries:
        rid, tid = entry.get("request_id"), entry.get("turn_id")
        if isinstance(rid, str) and isinstance(tid, str):
            bucket = found.setdefault(rid, [])
            if tid not in bucket:
                bucket.append(tid)
    return found


def filter_logs(
    entries: list[Entry],
    *,
    level: str = "debug",
    q: str = "",
    ident: str = "",
    file: str = "",
    after: int = 0,
    limit: int = 500,
) -> list[Entry]:
    """after>0 时返回 n 比它大的（实时追加用，最多 limit 条）；否则返回符合条件的最后 limit 条"""
    needle = q.strip().lower()
    ident = ident.strip()
    out: list[Entry] = []
    for entry in entries:
        if after and entry.n <= after:
            continue
        if not level_at_least(entry, level):
            continue
        if file and entry.source != file:
            continue
        if ident and not any(
            isinstance(entry.get(k), str)
            and (entry.get(k) == ident or entry.get(k).startswith(ident))
            for k in _ID_KEYS
        ):
            continue
        if needle and needle not in entry.line.lower():
            continue
        out.append(entry)
    if after:
        return out[:limit]
    return out[-limit:]


def log_metrics(entries: list[Entry], *, since: float) -> dict[str, Any]:
    retries: Counter[str] = Counter()
    sse_drops = 0
    server_errors = 0
    requests_total = 0
    for entry in entries:
        if entry.t < since:
            continue
        event = entry.event
        if event == "provider.retry":
            retries[str(entry.get("error_class"))] += 1
        elif event == "sse.close" and entry.get("reason") == "client_gone":
            sse_drops += 1
        elif event == "http.request" and entry.get("path") not in _HIDDEN_ROUTES:
            requests_total += 1
            status = _num(entry.get("status"))
            if status is not None and status >= 500:
                server_errors += 1
    return {
        "retries": dict(retries),
        "retries_total": sum(retries.values()),
        "sse_drops": sse_drops,
        "server_errors": server_errors,
        "requests": requests_total,
    }
