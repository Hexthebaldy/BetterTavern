"""剧本试玩（playtest.py）的分析：纯函数，不碰数据库，单测直接喂数据。

- 倒推每一回合的世界：从最终的世界状态开始，把撤销记录倒着套回去，得到“刚整理完第 N 回合时”的世界；
- 逐回合检查一致性规则（domain/world/invariants.py），只看这一回合新出现的问题；
- 找出退场（死去、永久离开）之后又被写进叙述的人和物：可能是回忆，也可能是写错了，列出来给人看；
- 统计导演和世界状态 agent 的用量、延迟，世界状态落后几回合，失败、跳过和被拒绝的修改；
- 导演用召回工具的情况（哪些回合提供了工具、用了几轮、首字慢了多少）和召回题的结果；
- 章节整理：写了几章、并进梗概几次，导演的上下文长度按回合段看稳不稳。
大纲的分析在 playtest_outline.py，花费和闪电模式的压缩在 playtest_lightning.py。
闪电模式（lightning=True）没有世界状态：不因为世界状态没整理而判不合格，报告里不写世界状态那几节。
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
    ThreadRecord,
    WorldRecords,
)

from .playtest_checks import CheckResult, ProbeResult

STATE_AGENT = "state_keeper"
DIRECTOR_AGENT = "director"
CHAPTER_AGENT = "chapter_writer"
# 导演上下文长度按多少回合一段来统计
CONTEXT_BUCKET_TURNS = 50
# 导演自己给出选项的回合至少占这么多，否则判为不合格（和 M0 合规率评测的标准一样）
OWN_OPTIONS_TARGET = 0.95
# 线索挂了这么多回合还没解开，算“挂太久”
STALE_THREAD_TURNS = 50


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
    threads = {t.id: t for t in world.threads}
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
        elif change.target == "thread":
            if change.after is None:
                threads.pop(str(row["id"]), None)
            else:
                threads[str(row["id"])] = ThreadRecord.from_json(change.after)
        elif change.after is None:
            facts.pop(str(row["id"]), None)
        else:
            facts[str(row["id"])] = FactRecord.from_json(change.after)
    return WorldRecords(
        entities=tuple(entities.values()),
        links=tuple(links.values()),
        facts=tuple(facts.values()),
        threads=tuple(threads.values()),
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


def token_totals(runs: Sequence[RunFacts]) -> dict[str, Any]:
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


def recall_use(
    runs: Sequence[RunFacts], tool_calls: Mapping[str, int] | None = None
) -> dict[str, Any]:
    """导演用召回工具的情况：提供了工具的回合里用了几轮，用工具和不用工具的首字时间。"""
    offered = [r for r in runs if int(r.result.get("recall_before") or 0) > 0]
    used = [r for r in offered if int(r.result.get("tool_rounds") or 0) > 0]
    unused = [r for r in offered if int(r.result.get("tool_rounds") or 0) == 0]

    def ttft(items: Sequence[RunFacts]) -> float | None:
        return percentile([float(r.ttft_ms) for r in items if r.ttft_ms is not None], 0.5)

    return {
        "offered_turns": len(offered),
        "used_turns": len(used),
        "used_ratio": round(len(used) / len(offered), 4) if offered else None,
        "rounds": dict(
            sorted(Counter(int(r.result.get("tool_rounds") or 0) for r in offered).items())
        ),
        "tool_calls": dict(tool_calls or {}),
        "ttft_ms_p50_with_tools": ttft(used),
        "ttft_ms_p50_without_tools": ttft(unused),
    }


def context_by_range(runs: Sequence[RunFacts]) -> list[dict[str, Any]]:
    """导演每回合发出去的上下文有多长（估算的 token 和服务商算的输入 token），按回合段统计。
    章节整理跟得上时应该稳定，不随回合数一直涨。"""
    buckets: dict[int, list[RunFacts]] = {}
    for run in runs:
        if run.seq is not None:
            buckets.setdefault(run.seq // CONTEXT_BUCKET_TURNS, []).append(run)
    out: list[dict[str, Any]] = []
    for index, items in sorted(buckets.items()):
        estimated = [int(r.result.get("estimated_tokens") or 0) for r in items]
        prompt = [r.input_tokens for r in items if r.input_tokens]
        cached = sum(r.cached_tokens for r in items)
        out.append(
            {
                "from": index * CONTEXT_BUCKET_TURNS,
                "to": (index + 1) * CONTEXT_BUCKET_TURNS - 1,
                "estimated_avg": round(statistics.mean(estimated)) if estimated else None,
                "estimated_max": max(estimated, default=None),
                "input_avg": round(statistics.mean(prompt)) if prompt else None,
                "cache_hit_ratio": round(cached / sum(prompt), 4) if prompt else None,
            }
        )
    return out


def thread_quality(final: WorldRecords, *, last_seq: int) -> dict[str, Any]:
    """线索：按种类和状态计数，挂了超过 STALE_THREAD_TURNS 回合还没解开的，写了答案的。"""
    open_threads = [t for t in final.threads if t.status == "open"]
    return {
        "threads": dict(Counter(f"{t.kind}:{t.status}" for t in final.threads)),
        "threads_stale": [
            {"since": t.opened_seq, "text": t.text}
            for t in sorted(open_threads, key=lambda t: t.opened_seq)
            if last_seq - t.opened_seq > STALE_THREAD_TURNS
        ],
        "threads_with_answer": sum(1 for t in final.threads if t.answer),
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
    probes: Sequence[ProbeResult] = (),
    tool_calls: Mapping[str, int] | None = None,
    summaries: Mapping[str, int] | None = None,
    lightning: bool = False,
) -> dict[str, Any]:
    director = [r for r in runs if r.agent == DIRECTOR_AGENT and r.status == "ok"]
    state = [r for r in runs if r.agent == STATE_AGENT]
    chapter_runs = [r for r in runs if r.agent == CHAPTER_AGENT]
    chapter_ms = [
        float(r.latency_ms) for r in chapter_runs if r.status == "ok" and r.latency_ms is not None
    ]
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
    if final_state_seq < head and not lightning:
        reasons.append("世界状态没整理到最后一回合")
    return {
        "mode": "lightning" if lightning else "standard",
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
            **token_totals(director),
        },
        "recall": {
            **recall_use(director, tool_calls),
            "probes": {
                "passed": sum(1 for p in probes if p.passed),
                "total": len(probes),
                "results": [p.to_json() for p in probes],
            },
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
            **token_totals(state),
        },
        "memory": {
            "runs": dict(Counter(r.status for r in chapter_runs)),
            "errors": dict(Counter(r.error_class for r in chapter_runs if r.error_class)),
            "summaries": dict(summaries or {}),
            "latency_ms_p50": percentile(chapter_ms, 0.5),
            "context": context_by_range(director),
            **token_totals(chapter_runs),
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
            **thread_quality(final, last_seq=final_state_seq),
        },
    }


def markdown(
    summary: Mapping[str, Any], *, title: str, playthrough_id: str, extra: Sequence[str] = ()
) -> str:
    """给人看的一页总结（中文）。extra 是别的模块写的几节（例如大纲、花费），
    普通模式放在章节整理后面；闪电模式没有章节整理和世界状态，只有导演、召回题和 extra。"""
    lightning = summary.get("mode") == "lightning"
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
        f"- 回合：{summary['turns']}"
        + (
            "；闪电模式，没有世界状态"
            if lightning
            else f"；世界状态整理到第 {s['processed_to']} 回合"
            + ("（已追上）" if s["caught_up"] else "（没追上）")
        ),
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
        *_recall_lines(summary["recall"]),
    ]
    if lightning:
        return "\n".join([*lines, *extra])
    lines += [
        *_memory_lines(summary["memory"]),
        *extra,
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
        f"- 线索（种类:状态）：{w['threads'] or '无'}；写了答案的 {w['threads_with_answer']} 条",
        f"- 挂了超过 {STALE_THREAD_TURNS} 回合还没解开的线索：{len(w['threads_stale'])} 条",
        *(f"  - 第 {t['since']} 回合起：{t['text']}" for t in w["threads_stale"][:10]),
        "",
    ]
    return "\n".join(lines)


def _memory_lines(m: Mapping[str, Any]) -> list[str]:
    lines = [
        "## 章节整理",
        f"- 运行：{m['runs'] or '无'}；失败原因：{m['errors'] or '无'}；"
        f"写好的：{m['summaries'] or '无'}（chapter 是章节摘要，synopsis 是全书梗概的版本）",
        f"- 每章耗时中位 {m['latency_ms_p50']} 毫秒；token：输入 {m['input_tokens']}"
        f"（缓存命中 {m['cache_hit_ratio']}），输出 {m['output_tokens']}",
        "- 导演的上下文长度（按回合段：估算 token 的平均 / 最大，服务商算的平均输入，缓存命中）：",
    ]
    for c in m["context"]:
        lines.append(
            f"  - 第 {c['from']}–{c['to']} 回合：{c['estimated_avg']} / {c['estimated_max']}，"
            f"{c['input_avg']}，{c['cache_hit_ratio']}"
        )
    lines.append("")
    return lines


def _recall_lines(r: Mapping[str, Any]) -> list[str]:
    probes = r["probes"]
    lines = [
        "## 召回",
        f"- 提供了召回工具的回合：{r['offered_turns']}；用了工具的：{r['used_turns']}"
        f"（{r['used_ratio']}）；用了几轮的分布：{r['rounds']}",
        f"- 各工具调用次数：{r['tool_calls'] or '无'}",
        f"- 首字等待中位：用了工具 {r['ttft_ms_p50_with_tools']} 毫秒，"
        f"没用 {r['ttft_ms_p50_without_tools']} 毫秒",
        f"- 召回题：答对 {probes['passed']} / {probes['total']}",
    ]
    for p in probes["results"]:
        mark = "对" if p["passed"] else "错"
        lines.append(
            f"  - 第 {p['turn']} 回合（{mark}）：要提到 {'、'.join(p['expect'])}；"
            f"导演用了 {p['tool_rounds']} 轮工具；{p['detail']}"
        )
    lines.append("")
    return lines
