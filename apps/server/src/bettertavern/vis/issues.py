"""自动挑出可疑之处。纯函数。

- turn_issues：一个回合的问题（失败、首字太慢、格式要修补、断线……），按严重程度排好；
- recent_problems：一段时间里所有警告和错误，按事件名归类计数，每类带最近一条做例子。

每个问题是英文代号加字段，网页负责写成中文。严重程度：error（出错了）、warn（值得看看）、info（知道一下）。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .logstore import Entry, level_at_least
from .timeline import Timeline

SLOW_FIRST_TOKEN_MS = 5_000
SLOW_TURN_MS = 30_000
TIGHT_CONTEXT = 0.85
LOW_CACHE = 0.3
LOW_CACHE_MIN_PROMPT = 2_000

_RANK = {"error": 0, "warn": 1, "info": 2}


@dataclass
class Issue:
    severity: str
    code: str
    fields: dict[str, Any] = field(default_factory=dict)
    ref: int | None = None

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def turn_issues(
    entries: list[Entry],
    timeline: Timeline,
    *,
    turn: dict[str, Any] | None = None,
    runs: list[dict[str, Any]] | None = None,
) -> list[Issue]:
    """turn 是数据库里的回合（可能没有），runs 是它的模型调用记录"""
    issues: list[Issue] = []
    by_event: dict[str, list[Entry]] = {}
    for e in entries:
        by_event.setdefault(e.event, []).append(e)

    def first(event: str) -> Entry | None:
        found = by_event.get(event)
        return found[0] if found else None

    status = (turn or {}).get("status")
    error = (turn or {}).get("error") or {}
    failed = first("turn.failed")
    if failed is not None or status == "failed":
        code = (failed.get("code") if failed else None) or error.get("code")
        message = (failed.get("message") if failed else None) or error.get("message")
        issues.append(
            Issue(
                "error",
                "turn_failed",
                {
                    "code": code,
                    "message": message,
                    "cancel_reason": failed.get("cancel_reason") if failed else None,
                },
                failed.n if failed else None,
            )
        )
    for event, code in (
        ("turn.commit_rejected", "commit_rejected"),
        ("turn.crashed", "turn_crashed"),
        ("turn.lease_expired", "lease_expired"),
    ):
        hit = first(event)
        if hit is not None:
            issues.append(Issue("error", code, {}, hit.n))

    provider_failed = first("provider.failed")
    if provider_failed is not None:
        issues.append(
            Issue(
                "error",
                "provider_failed",
                {
                    k: provider_failed.get(k)
                    for k in ("error_class", "status", "partial")
                    if provider_failed.get(k) is not None
                },
                provider_failed.n,
            )
        )
    slot_timeout = first("provider.slot_timeout")
    if slot_timeout is not None:
        issues.append(Issue("error", "slot_timeout", {}, slot_timeout.n))
    slot = first("provider.slot_wait")
    if slot is not None:
        issues.append(Issue("info", "slot_wait", {"duration_ms": slot.get("duration_ms")}, slot.n))

    first_token = first("provider.first_token")
    ttft = _num(first_token.get("ttft_ms")) if first_token else None
    if ttft is None:
        for run in runs or []:
            if run.get("agent") == "director" and _num(run.get("ttft_ms")) is not None:
                ttft = _num(run.get("ttft_ms"))
    if ttft is not None and ttft >= SLOW_FIRST_TOKEN_MS:
        issues.append(
            Issue(
                "warn",
                "slow_first_token",
                {"ttft_ms": ttft},
                first_token.n if first_token else None,
            )
        )

    turn_span = next((s for s in timeline.spans if s.kind == "turn"), None)
    if turn_span is not None and turn_span.end - turn_span.start >= SLOW_TURN_MS:
        issues.append(
            Issue(
                "warn",
                "slow_turn",
                {"duration_ms": round(turn_span.end - turn_span.start)},
                turn_span.ref,
            )
        )

    parse = first("director.parse")
    if parse is not None:
        stage = parse.get("stage")
        if stage == "narrative_missing":
            issues.append(Issue("error", "parse_narrative_missing", {}, parse.n))
        elif stage in ("repaired", "fallback", "missing"):
            issues.append(
                Issue(
                    "warn",
                    f"parse_{stage}",
                    {"repairs": parse.get("repairs"), "notes": parse.get("notes")},
                    parse.n,
                )
            )
        elif stage == "salvaged":
            issues.append(
                Issue("info", "parse_salvaged", {"repairs": parse.get("repairs")}, parse.n)
            )
    repair_failed = first("options.repair_failed")
    if repair_failed is not None:
        issues.append(
            Issue(
                "warn",
                "repair_failed",
                {"error_class": repair_failed.get("error_class")},
                repair_failed.n,
            )
        )

    overflow = first("turn.context_overflow_retry")
    if overflow is not None:
        issues.append(
            Issue("warn", "context_overflow", {"window": overflow.get("window")}, overflow.n)
        )
    contexts = by_event.get("context.assembled", [])
    if contexts:
        ratio = _num(contexts[-1].get("usage_ratio"))
        if ratio is not None and ratio >= TIGHT_CONTEXT:
            issues.append(Issue("info", "context_tight", {"usage_ratio": ratio}, contexts[-1].n))

    response = first("provider.response")
    prompt = _num(response.get("prompt_tokens")) if response else None
    cached = _num(response.get("cached_tokens")) if response else None
    seq = (turn or {}).get("seq")
    if (
        response is not None
        and prompt is not None
        and cached is not None
        and prompt >= LOW_CACHE_MIN_PROMPT
        and (seq or 0) >= 2
        and cached / prompt < LOW_CACHE
    ):
        issues.append(
            Issue(
                "info",
                "low_cache",
                {"ratio": round(cached / prompt, 3), "prompt_tokens": prompt},
                response.n,
            )
        )

    world = first("world.build.done")
    if world is not None and world.get("source") == "minimal":
        issues.append(
            Issue("warn", "world_minimal", {"error_class": world.get("error_class")}, world.n)
        )

    dropped = [s for s in timeline.spans if s.kind == "sse" and s.fields.get("dropped")]
    if dropped:
        issues.append(Issue("info", "sse_dropped", {"count": len(dropped)}, dropped[0].ref))
    snapshot = [e for e in by_event.get("sse.subscribe", []) if e.get("mode") == "snapshot"]
    if snapshot:
        issues.append(Issue("info", "sse_snapshot", {}, snapshot[0].n))

    slow_submit = [
        s
        for s in timeline.spans
        if s.kind == "http" and _num(s.fields.get("duration_ms")) and s.end - s.start >= 2_000
    ]
    if slow_submit:
        issues.append(
            Issue(
                "warn",
                "slow_request",
                {"duration_ms": round(slow_submit[0].end - slow_submit[0].start)},
                slow_submit[0].ref,
            )
        )

    if not entries and turn is not None:
        issues.append(Issue("info", "no_logs", {}, None))

    issues.sort(key=lambda i: _RANK.get(i.severity, 3))
    return issues


@dataclass
class ProblemGroup:
    event: str
    level: str
    count: int
    last_t: float
    sample: dict[str, Any]

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


# 这些警告是正常运转的一部分，不算问题
_NOT_PROBLEMS = frozenset({"secrets.dev_generated", "provider.slot_wait"})


def recent_problems(entries: list[Entry], *, since: float) -> list[ProblemGroup]:
    groups: dict[str, ProblemGroup] = {}
    for e in entries:
        if e.t < since or not level_at_least(e, "warning") or e.event in _NOT_PROBLEMS:
            continue
        group = groups.get(e.event)
        if group is None:
            groups[e.event] = ProblemGroup(e.event, e.level, 1, e.t, e.to_json())
        else:
            group.count += 1
            if e.t >= group.last_t:
                group.last_t, group.sample = e.t, e.to_json()
            if _RANK.get("error" if e.level in ("error", "critical") else "warn", 1) < _RANK.get(
                "error" if group.level in ("error", "critical") else "warn", 1
            ):
                group.level = e.level
    return sorted(groups.values(), key=lambda g: g.last_t, reverse=True)
