"""剧本试玩的花费统计和闪电模式的报告。"""

from __future__ import annotations

from evals.playtest_lightning import compress_summary, cost_summary
from evals.playtest_report import RunFacts, TurnFacts, markdown, summarize

RUNS = [
    RunFacts(0, "director", "ok", input_tokens=1000, cached_tokens=0, output_tokens=200),
    RunFacts(1, "director", "ok", input_tokens=1400, cached_tokens=1000, output_tokens=200),
    RunFacts(
        None,
        "compressor",
        "ok",
        input_tokens=1500,
        cached_tokens=1400,
        output_tokens=300,
        latency_ms=8000,
        result={"first_seq": 0, "last_seq": 1},
    ),
    RunFacts(None, "compressor", "failed", error_class="timeout"),
]


def test_cost_is_totalled_per_agent_and_per_turn() -> None:
    cost = cost_summary(RUNS, turns=2)
    assert cost["input_tokens"] == 3900 and cost["cached_tokens"] == 2400
    # 没命中缓存的输入单独算：服务商对它收全价
    assert cost["uncached_input_tokens"] == 1500
    assert cost["per_turn"] == {"input": 1950, "uncached_input": 750, "output": 350}
    assert set(cost["by_agent"]) == {"compressor", "director"}
    assert cost["by_agent"]["director"]["output_tokens"] == 400


def test_compression_is_summarised() -> None:
    c = compress_summary(RUNS, {"synopsis": 1})
    assert c["runs"] == {"ok": 1, "failed": 1} and c["errors"] == {"timeout": 1}
    assert c["synopsis_versions"] == 1 and c["covered_to"] == 1
    assert c["cache_hit_ratio"] == round(1400 / 1500, 4)


def test_a_lightning_run_is_not_failed_for_having_no_world_state() -> None:
    turns = [TurnFacts(s, "option", "", "", -1, "model") for s in range(2)]
    summary = summarize(turns, RUNS, {}, skipped=[], final_state_seq=-1, lightning=True)
    assert summary["mode"] == "lightning"
    assert summary["verdict"] == {"passed": True, "reasons": []}
    page = markdown(summary, title="测试", playthrough_id="pt-1", extra=["## 花费"])
    assert "闪电模式，没有世界状态" in page and "## 花费" in page
    assert "## 世界状态 agent" not in page and "## 落后" not in page
    # 普通模式下同样的数据要判不合格：世界状态没整理到最后一回合
    standard = summarize(turns, RUNS, {}, skipped=[], final_state_seq=-1)
    assert standard["verdict"]["reasons"] == ["世界状态没整理到最后一回合"]
