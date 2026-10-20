"""剧本试玩（playtest.py）的分析：纯函数，不碰数据库，单测直接喂数据。

- 倒推每一回合的世界：从最终的世界状态开始，把撤销记录倒着套回去，得到“刚整理完第 N 回合时”的世界；
- 逐回合检查一致性规则（domain/world/invariants.py），只看这一回合新出现的问题；
- 找出退场（死去、永久离开）之后又被写进叙述的人和物：可能是回忆，也可能是写错了，列出来给人看；
- 统计导演和世界状态 agent 的用量、延迟，世界状态落后几回合，失败、跳过和被拒绝的修改。
"""

from __future__ import annotations

import statistics
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from bettertavern.domain.world.invariants import Issue, check_world, new_issues
from bettertavern.domain.world.mentions import mentioned
from bettertavern.domain.world.records import (
    EntityRecord,
    FactRecord,
    LinkRecord,
    RowChange,
    WorldRecords,
)

from .playtest_checks import CheckResult

STATE_AGENT = "state_keeper"
DIRECTOR_AGENT = "director"
# 导演自己给出选项的回合至少占这么多，否则判为不合格（和 M0 合规率评测的标准一样）
OWN_OPTIONS_TARGET = 0.95


@dataclass(frozen=True)
class TurnFacts:
    """故事线上的一回合（从 turns 表查出）。"""

    seq: int
    source: str  # opening / option / text / ending
    action: str
    narrative: str
    state_seq: int  # 写这一回合时，状态块截至第几回合
    options_source: str | None = None


@dataclass(frozen=True)
class RunFacts:
    """一次 agent 运行（agent_runs 的一行）。"""

    seq: int | None
    agent: str
    status: str
    error_class: str | None = None
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int | None = None
    ttft_ms: int | None = None
    result: Mapping[str, Any] = field(default_factory=dict)


# ---- 倒推每一回合的世界 ----------------------------------------------------------------
def apply_changes(world: WorldRecords, changes: Iterable[RowChange]) -> WorldRecords:
    """把改动作用到内存里的世界上：before 为空就加上这一行，after 为空就去掉，
    否则整行换成 after。"""
    entities = {e.id: e for e in world.entities}
    links = {lk.key: lk for lk in world.links}
    facts = {f.id: f for f in world.facts}
    for change in changes:
        row = change.after if change.after is not None else change.before
        assert row is not None
        if change.target == "entity":
            if change.after is None:
                entities.pop(str(row["id"]), None)
            else:
                entities[str(row["id"])] = EntityRecord.from_json(change.after)
        elif change.target == "link":
            key = (str(row["src_id"]), str(row["rel"]), str(row["dst_id"]))
            if change.after is None:
                links.pop(key, None)
            else:
                links[key] = LinkRecord.from_json(change.after)
        elif change.after is None:
            facts.pop(str(row["id"]), None)
        else:
            facts[str(row["id"])] = FactRecord.from_json(change.after)
    return WorldRecords(
        entities=tuple(entities.values()), links=tuple(links.values()), facts=tuple(facts.values())
    )


def worlds_by_turn(
    final: WorldRecords, patches: Mapping[int, Sequence[RowChange]], last_seq: int
) -> dict[int, WorldRecords]:
    """每一回合整理完以后的世界，键是回合号；-1 是还没整理任何回合时（开局）的世界。

    final 是整理完 last_seq 回合以后的世界；patches 是每回合按写入顺序排的改动。
    """
    worlds = {last_seq: final}
    current = final
    for seq in range(last_seq, -1, -1):
        undo = [RowChange(c.target, c.after, c.before) for c in reversed(patches.get(seq, ()))]
        current = apply_changes(current, undo)
        worlds[seq - 1] = current
    return worlds


def issues_by_turn(worlds: Mapping[int, WorldRecords]) -> dict[int, list[Issue]]:
    """每一回合新出现的一致性问题（开局就有的不算）。只列有问题的回合。"""
    found: dict[int, list[Issue]] = {}
    for seq in sorted(s for s in worlds if s >= 0):
        issues = new_issues(worlds[seq - 1], worlds[seq])
        if issues:
            found[seq] = issues
    return found


@dataclass(frozen=True)
class RetiredMention:
    seq: int  # 在哪一回合的叙述里又出现了
    name: str
    retired_seq: int  # 在哪一回合退场的


def retired_mentions(
    worlds: Mapping[int, WorldRecords], turns: Sequence[TurnFacts]
) -> list[RetiredMention]:
    """退场之后又被写进叙述的人和物（按名字和别名找）。可能是回忆，也可能是写错了。"""
    retired_at: dict[str, tuple[int, EntityRecord]] = {}
    for seq in sorted(s for s in worlds if s >= 0):
        before = {e.id: e for e in worlds[seq - 1].entities}
        for entity in worlds[seq].entities:
            old = before.get(entity.id)
            if entity.retired and (old is None or not old.retired) and entity.kind != "world":
                retired_at.setdefault(entity.id, (seq, entity))
    found: list[RetiredMention] = []
    for turn in turns:
        gone = [entity for seq, entity in retired_at.values() if seq < turn.seq]
        for entity in mentioned(gone, [turn.narrative]):
            found.append(RetiredMention(turn.seq, entity.name, retired_at[entity.id][0]))
    return found


# ---- 统计 ------------------------------------------------------------------------------
def percentile(values: Sequence[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(round(q * (len(ordered) - 1)), len(ordered) - 1)]


def _tokens(runs: Sequence[RunFacts]) -> dict[str, Any]:
    prompt = sum(r.input_tokens for r in runs)
    cached = sum(r.cached_tokens for r in runs)
    return {
        "input_tokens": prompt,
        "cached_tokens": cached,
        "output_tokens": sum(r.output_tokens for r in runs),
        "cache_hit_ratio": round(cached / prompt, 4) if prompt else None,
    }


def lag_by_turn(turns: Sequence[TurnFacts]) -> dict[int, int]:
    """导演写第 N 回合时，世界状态落后几回合：N - 1 减去状态块截至的回合。"""
    return {t.seq: max(t.seq - 1 - t.state_seq, 0) for t in turns if t.seq > 0}


def own_options(turns: Sequence[TurnFacts]) -> dict[str, Any]:
    """导演自己给出选项的比例（结局那一轮不算）。"""
    counted = [t for t in turns if t.source != "ending"]
    own = sum(1 for t in counted if t.options_source == "model")
    ratio = own / len(counted) if counted else 0.0
    return {
        "own": own,
        "total": len(counted),
        "ratio": round(ratio, 4),
        "passed": ratio >= OWN_OPTIONS_TARGET,
    }


def world_quality(final: WorldRecords, *, protagonist: str, last_seq: int) -> dict[str, Any]:
    """看世界状态有没有记成流水账、建了多少一次性的人和地方。"""
    active = [f for f in final.facts if f.status == "active"]
    by_hero = sum(1 for f in active if protagonist and f.text.startswith(protagonist))
    one_turn = Counter(
        e.kind
        for e in final.entities
        if e.kind in ("character", "location")
        and 0 < e.first_seq < last_seq
        and e.last_seen_seq == e.first_seq
    )
    return {
        "facts_by_protagonist": by_hero,
        "facts_by_protagonist_ratio": round(by_hero / len(active), 4) if active else None,
        "one_turn_characters": one_turn["character"],
        "one_turn_locations": one_turn["location"],
    }


def summarize(
    turns: Sequence[TurnFacts],
    runs: Sequence[RunFacts],
    worlds: Mapping[int, WorldRecords],
    *,
    skipped: Sequence[int],
    final_state_seq: int,
    checks: Sequence[CheckResult] = (),
    protagonist: str = "",
) -> dict[str, Any]:
    director = [r for r in runs if r.agent == DIRECTOR_AGENT and r.status == "ok"]
    state = [r for r in runs if r.agent == STATE_AGENT]
    state_ok = [r for r in state if r.status == "ok"]
    lags = list(lag_by_turn(turns).values())
    head = max((t.seq for t in turns), default=-1)
    final = worlds.get(final_state_seq, WorldRecords())
    ttfts = [float(r.ttft_ms) for r in director if r.ttft_ms is not None]
    director_ms = [float(r.latency_ms) for r in director if r.latency_ms is not None]
    state_ms = [float(r.latency_ms) for r in state_ok if r.latency_ms is not None]
    calls = [int(r.result.get("model_calls") or 0) for r in state_ok]
    changes = [int(r.result.get("changes") or 0) for r in state_ok]
    rejected = Counter(
        f"{item.get('tool')}:{item.get('code')}"
        for r in state
        for item in r.result.get("rejected") or ()
        if isinstance(item, Mapping)
    )
    issues = issues_by_turn(worlds)
    mentions = retired_mentions(worlds, turns)
    options = own_options(turns)
    passed_checks = sum(1 for c in checks if c.passed)
    reasons: list[str] = []
    if not options["passed"]:
        reasons.append(
            f"导演自己给出选项的回合 {options['ratio']:.0%}，低于 {OWN_OPTIONS_TARGET:.0%}"
        )
    if passed_checks < len(checks):
        reasons.append(f"检查点只过了 {passed_checks} / {len(checks)}")
    if issues:
        reasons.append(f"{len(issues)} 个回合出现了一致性问题")
    if final_state_seq < head:
        reasons.append("世界状态没整理到最后一回合")
    return {
        "verdict": {"passed": not reasons, "reasons": reasons},
        "options": options,
        "checks": {
            "passed": passed_checks,
            "total": len(checks),
            "results": [c.to_json() for c in checks],
        },
        "turns": head + 1,
        "director": {
            "runs": len(director),
            "ttft_ms_p50": percentile(ttfts, 0.5),
            "ttft_ms_p95": percentile(ttfts, 0.95),
            "latency_ms_p50": percentile(director_ms, 0.5),
            "options_source": dict(Counter(t.options_source for t in turns if t.options_source)),
            **_tokens(director),
        },
        "state": {
            "processed_to": final_state_seq,
            "caught_up": final_state_seq >= head,
            "runs": dict(Counter(r.status for r in state)),
            "errors": dict(Counter(r.error_class for r in state if r.error_class)),
            "skipped_turns": list(skipped),
            "model_calls_avg": round(statistics.mean(calls), 2) if calls else None,
            "model_calls_max": max(calls, default=None),
            "changes_avg": round(statistics.mean(changes), 2) if changes else None,
            "latency_ms_p50": percentile(state_ms, 0.5),
            "latency_ms_p95": percentile(state_ms, 0.95),
            "rejected": sum(rejected.values()),
            "top_rejected": rejected.most_common(10),
            **_tokens(state),
        },
        "lag": {
            "max": max(lags, default=0),
            "mean": round(statistics.mean(lags), 2) if lags else 0,
            "turns_behind": sum(1 for lag in lags if lag > 0),
            "histogram": dict(sorted(Counter(lags).items())),
        },
        "consistency": {
            "turns_with_new_issues": {
                seq: [i.code for i in found] for seq, found in sorted(issues.items())
            },
            "final_issues": [i.code for i in check_world(final)],
            "retired_mentions": [
                {"seq": m.seq, "name": m.name, "retired_seq": m.retired_seq} for m in mentions
            ],
        },
        "world": {
            **world_quality(final, protagonist=protagonist, last_seq=final_state_seq),
            "entities": dict(
                Counter(e.kind for e in final.entities if not e.retired and e.kind != "world")
            ),
            "sketch": sum(1 for e in final.entities if e.canon == "sketch" and not e.retired),
            "retired": sum(1 for e in final.entities if e.retired),
            "facts_active": sum(1 for f in final.facts if f.status == "active"),
            "facts_superseded": sum(1 for f in final.facts if f.status != "active"),
            "links": len(final.links),
        },
    }


def markdown(summary: Mapping[str, Any], *, title: str, playthrough_id: str) -> str:
    """给人看的一页总结（中文）。"""
    d, s, lag, c, w = (
        summary["director"],
        summary["state"],
        summary["lag"],
        summary["consistency"],
        summary["world"],
    )
    verdict, options, checks = summary["verdict"], summary["options"], summary["checks"]
    lines = [
        f"# {title}",
        "",
        "**结论：合格**"
        if verdict["passed"]
        else "**结论：不合格**：" + "；".join(verdict["reasons"]),
        "",
        f"- 存档：`{playthrough_id}`"
        "（日志查看工具里打开这局，逐回合看导演和世界状态 agent 的每一步）",
        f"- 回合：{summary['turns']}；世界状态整理到第 {s['processed_to']} 回合"
        + ("（已追上）" if s["caught_up"] else "（没追上）"),
        f"- 导演自己给出选项：{options['own']} / {options['total']}（{options['ratio']:.0%}，"
        f"要求至少 {OWN_OPTIONS_TARGET:.0%}）",
        f"- 检查点：通过 {checks['passed']} / {checks['total']}",
        "",
    ]
    failed = [r for r in checks["results"] if not r["passed"]]
    if failed:
        lines.append("## 没通过的检查点")
        for r in failed:
            lines.append(
                f"- 第 {r['after']} 回合后 {r['kind']} {'、'.join(r['args'])}：{r['detail']}"
            )
        lines.append("")
    lines += [
        "## 导演",
        f"- 首字等待：中位 {d['ttft_ms_p50']} 毫秒，95% {d['ttft_ms_p95']} 毫秒；"
        f"写完一段中位 {d['latency_ms_p50']} 毫秒",
        f"- 选项来源：{d['options_source']}",
        f"- token：输入 {d['input_tokens']}（缓存命中 {d['cache_hit_ratio']}），"
        f"输出 {d['output_tokens']}",
        "",
        "## 世界状态 agent",
        f"- 运行：{s['runs']}；失败原因：{s['errors'] or '无'}；"
        f"跳过的回合：{s['skipped_turns'] or '无'}",
        f"- 每回合调模型：平均 {s['model_calls_avg']} 次，最多 {s['model_calls_max']} 次；"
        f"改动平均 {s['changes_avg']} 行",
        f"- 耗时：中位 {s['latency_ms_p50']} 毫秒，95% {s['latency_ms_p95']} 毫秒",
        f"- 被拒绝的修改：{s['rejected']} 次；最多的：{s['top_rejected'] or '无'}",
        f"- token：输入 {s['input_tokens']}（缓存命中 {s['cache_hit_ratio']}），"
        f"输出 {s['output_tokens']}",
        "",
        "## 落后",
        f"- 导演写某一回合时，世界状态最多落后 {lag['max']} 回合，平均 {lag['mean']}；"
        f"有 {lag['turns_behind']} 回合落后",
        f"- 分布（落后几回合: 回合数）：{lag['histogram']}",
        "",
        "## 一致性",
        f"- 出现新问题的回合：{c['turns_with_new_issues'] or '无'}",
        f"- 最终世界里的问题：{c['final_issues'] or '无'}",
        f"- 退场后又被写进叙述（可能是回忆，要人工看一眼）：{len(c['retired_mentions'])} 处",
    ]
    for m in c["retired_mentions"][:20]:
        lines.append(f"  - 第 {m['seq']} 回合写到了 {m['name']}（第 {m['retired_seq']} 回合退场）")
    lines += [
        "",
        "## 最终的世界",
        f"- 实体：{w['entities']}；铅笔实体 {w['sketch']} 个；已退场 {w['retired']} 个",
        f"- 只出现过一回合的：人物 {w['one_turn_characters']} 个，"
        f"地点 {w['one_turn_locations']} 个",
        f"- 以主角名字开头的事实（多半是流水账）：{w['facts_by_protagonist']} 条"
        f"（占有效事实 {w['facts_by_protagonist_ratio']}）",
        f"- 事实：有效 {w['facts_active']} 条，被推翻 {w['facts_superseded']} 条；"
        f"关系 {w['links']} 条",
        "",
    ]
    return "\n".join(lines)
