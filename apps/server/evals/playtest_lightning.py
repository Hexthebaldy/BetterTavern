"""剧本试玩（playtest.py）的花费统计和闪电模式的分析：纯函数，不碰数据库。

- 花费：这一局所有模型请求合计的 token（导演、开局、补选项、后台整理、压缩），按 agent 分开，
  再按回合平均。普通模式和闪电模式的报告都有这一节，同一份剧本两种模式各跑一次就能比。
- 压缩（只有闪电模式，docs/agent-runtime.md 的“闪电模式”）：跑了几次、失败原因、写了几版梗概、
  耗时和 token，以及导演的上下文长度稳不稳（梗概写好后原文应该整块变短）。
闪电模式没有世界状态，世界状态的检查点、落后和一致性都不适用，报告里不写那几节（playtest_report.py）。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from .playtest_report import RunFacts, percentile, token_totals

COMPRESSOR_AGENT = "compressor"


def cost_summary(runs: Sequence[RunFacts], turns: int) -> dict[str, Any]:
    """turns 是故事线上的回合数（含开场）。没命中缓存的输入单独算：服务商对它收全价。"""
    totals = token_totals(runs)
    uncached = totals["input_tokens"] - totals["cached_tokens"]
    by_agent = {
        agent: token_totals([r for r in runs if r.agent == agent])
        for agent in sorted({r.agent for r in runs})
    }

    def per_turn(value: int) -> int | None:
        return round(value / turns) if turns else None

    return {
        **totals,
        "uncached_input_tokens": uncached,
        "per_turn": {
            "input": per_turn(totals["input_tokens"]),
            "uncached_input": per_turn(uncached),
            "output": per_turn(totals["output_tokens"]),
        },
        "by_agent": by_agent,
    }


def compress_summary(runs: Sequence[RunFacts], summaries: Mapping[str, int]) -> dict[str, Any]:
    compress = [r for r in runs if r.agent == COMPRESSOR_AGENT]
    latency = [
        float(r.latency_ms) for r in compress if r.status == "ok" and r.latency_ms is not None
    ]
    return {
        "runs": dict(Counter(r.status for r in compress)),
        "errors": dict(Counter(r.error_class for r in compress if r.error_class)),
        "synopsis_versions": int(summaries.get("synopsis", 0)),
        "covered_to": max(
            (int(r.result.get("last_seq", -1)) for r in compress if r.status == "ok"),
            default=None,
        ),
        "latency_ms_p50": percentile(latency, 0.5),
        **token_totals(compress),
    }


def cost_lines(cost: Mapping[str, Any]) -> list[str]:
    per = cost["per_turn"]
    lines = [
        "## 花费",
        f"- 合计 token：输入 {cost['input_tokens']}（缓存命中 {cost['cache_hit_ratio']}，"
        f"没命中的 {cost['uncached_input_tokens']}），输出 {cost['output_tokens']}",
        f"- 每回合平均：输入 {per['input']}，没命中缓存的输入 {per['uncached_input']}，"
        f"输出 {per['output']}",
        "- 按 agent（输入 / 缓存命中 / 输出）：",
    ]
    for agent, t in cost["by_agent"].items():
        lines.append(
            f"  - {agent}：{t['input_tokens']} / {t['cache_hit_ratio']} / {t['output_tokens']}"
        )
    lines.append("")
    return lines


def compress_lines(summary: Mapping[str, Any]) -> list[str]:
    c = summary["lightning"]
    lines = [
        "## 压缩（闪电模式）",
        f"- 运行：{c['runs'] or '无'}；失败原因：{c['errors'] or '无'}；"
        f"写好的梗概：{c['synopsis_versions']} 版，覆盖到第 {c['covered_to']} 回合",
        f"- 每次耗时中位 {c['latency_ms_p50']} 毫秒；token：输入 {c['input_tokens']}"
        f"（缓存命中 {c['cache_hit_ratio']}），输出 {c['output_tokens']}",
        "- 导演的上下文长度（按回合段：估算 token 的平均 / 最大，服务商算的平均输入，缓存命中）：",
    ]
    for r in summary["memory"]["context"]:
        lines.append(
            f"  - 第 {r['from']}–{r['to']} 回合：{r['estimated_avg']} / {r['estimated_max']}，"
            f"{r['input_avg']}，{r['cache_hit_ratio']}"
        )
    lines.append("")
    return lines
