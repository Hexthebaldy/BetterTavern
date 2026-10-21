"""剧本试玩（playtest.py）里的大纲：纯函数，不碰数据库，单测直接喂数据。

- 每次修订：依据到第几回合、改没改、原因、改完以后进行中的那一拍；
- 世界状态 agent 说“大纲要改”的回合和原因；
- 剧本里的大纲检查（outline）：按回合段写，依据在这一段里的修订改了几次（至少、至多，第一版不算），
  这一段结束时正在用的那一版大纲有没有提到某些词（玩家走偏以后大纲有没有跟上）。只列结果，不算进结论。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .playtest_report import RunFacts, percentile, token_totals

OUTLINE_AGENT = "outline_writer"


@dataclass(frozen=True)
class OutlineWindow:
    first: int
    last: int
    min_changes: int = 0
    max_changes: int | None = None
    # 这一段结束时正在用的那一版大纲（前提和还没完成的拍）里至少要有其中一个词；空的不检查
    mentions: tuple[str, ...] = ()


@dataclass(frozen=True)
class Revision:
    based_on_seq: int
    changed: bool
    reason: str
    premise: str = ""
    active: str = ""  # 进行中的那一拍
    ahead: tuple[str, ...] = ()  # 进行中和待写的拍


def parse_windows(raw: Sequence[Mapping[str, Any]] | None) -> list[OutlineWindow]:
    windows: list[OutlineWindow] = []
    for item in raw or ():
        top = item.get("max_changes")
        windows.append(
            OutlineWindow(
                first=int(item["from"]),
                last=int(item["to"]),
                min_changes=int(item.get("min_changes") or 0),
                max_changes=None if top is None else int(top),
                mentions=tuple(str(w) for w in item.get("mentions") or ()),
            )
        )
    return windows


def revision_from_row(
    based_on_seq: int, changed: bool, content: Mapping[str, Any] | None, reason: str
) -> Revision:
    if not changed or not content:
        return Revision(based_on_seq, False, reason)
    beats = [b for b in content.get("beats") or () if isinstance(b, Mapping)]
    active = next((str(b.get("intent") or "") for b in beats if b.get("status") == "active"), "")
    ahead = tuple(
        str(b.get("intent") or "") for b in beats if b.get("status") in ("active", "pending")
    )
    return Revision(based_on_seq, True, reason, str(content.get("premise") or ""), active, ahead)


def evaluate_windows(
    windows: Sequence[OutlineWindow], revisions: Sequence[Revision]
) -> list[dict[str, Any]]:
    changed = [r for r in revisions if r.changed]
    later = changed[1:]  # 第一版不算“改”
    results: list[dict[str, Any]] = []
    for w in windows:
        inside = [r for r in later if w.first <= r.based_on_seq <= w.last]
        problems: list[str] = []
        if len(inside) < w.min_changes:
            problems.append(f"只改了 {len(inside)} 次，至少要 {w.min_changes} 次")
        if w.max_changes is not None and len(inside) > w.max_changes:
            problems.append(f"改了 {len(inside)} 次，至多 {w.max_changes} 次")
        if w.mentions:
            current = next((r for r in reversed(changed) if r.based_on_seq <= w.last), None)
            text = " ".join((current.premise, *current.ahead)) if current else ""
            if not any(word in text for word in w.mentions):
                problems.append(f"第 {w.last} 回合时的大纲里没有提到：" + "、".join(w.mentions))
        results.append(
            {
                "from": w.first,
                "to": w.last,
                "changes": len(inside),
                "passed": not problems,
                "detail": "；".join(problems) or "通过",
            }
        )
    return results


def outline_summary(
    revisions: Sequence[Revision],
    reasons: Sequence[tuple[int, str]],
    runs: Sequence[RunFacts],
    windows: Sequence[OutlineWindow] = (),
) -> dict[str, Any]:
    outline_runs = [r for r in runs if r.agent == OUTLINE_AGENT]
    latencies = [
        float(r.latency_ms) for r in outline_runs if r.status == "ok" and r.latency_ms is not None
    ]
    first = next((r.based_on_seq for r in revisions if r.changed), None)
    checks = evaluate_windows(windows, revisions)
    changed = sum(1 for r in revisions if r.changed)
    return {
        "first_seq": first,
        "revised": changed - 1 if first is not None else 0,  # 第一版之后改了几次
        "kept": sum(1 for r in revisions if not r.changed),
        "reasons": len(reasons),
        "runs": dict(Counter(r.status for r in outline_runs)),
        "errors": dict(Counter(r.error_class for r in outline_runs if r.error_class)),
        "latency_ms_p50": percentile(latencies, 0.5),
        **token_totals(outline_runs),
        "revisions": [
            {
                "seq": r.based_on_seq,
                "changed": r.changed,
                "reason": r.reason,
                "active": r.active,
                "premise": r.premise,
            }
            for r in revisions
        ],
        "reason_list": [{"seq": s, "reason": t} for s, t in reasons],
        "checks": {"passed": sum(1 for c in checks if c["passed"]), "results": checks},
    }


def outline_lines(o: Mapping[str, Any]) -> list[str]:
    checks = o["checks"]
    lines = [
        "## 大纲",
        "- 还没有大纲"
        if o["first_seq"] is None
        else f"- 第一版依据到第 {o['first_seq']} 回合；之后改了 {o['revised']} 次，"
        f"不改 {o['kept']} 次；世界状态 agent 说“要改” {o['reasons']} 次",
        f"- 运行：{o['runs'] or '无'}；失败原因：{o['errors'] or '无'}；"
        f"耗时中位 {o['latency_ms_p50']} 毫秒；token：输入 {o['input_tokens']}"
        f"（缓存命中 {o['cache_hit_ratio']}），输出 {o['output_tokens']}",
    ]
    if checks["results"]:
        lines.append(f"- 大纲检查：通过 {checks['passed']} / {len(checks['results'])}")
        for c in checks["results"]:
            lines.append(
                f"  - 第 {c['from']}–{c['to']} 回合：改了 {c['changes']} 次；{c['detail']}"
            )
    lines.append("- 每次修订（依据到第几回合：改没改，进行中的那一拍；原因）：")
    for r in o["revisions"]:
        mark = "改" if r["changed"] else "不改"
        beat = f"，{r['active']}" if r["active"] else ""
        lines.append(f"  - 第 {r['seq']} 回合：{mark}{beat}；{r['reason'] or '（第一版）'}")
    lines.append("")
    return lines
