"""剧本试玩的分析：倒推每回合的世界、新出现的问题、退场后又被写到的人、落后和总结。"""

from __future__ import annotations

from typing import Any

from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.records import (
    EntityRecord,
    FactRecord,
    LinkRecord,
    RowChange,
    ThreadRecord,
    WorldRecords,
)
from evals.playtest_checks import Check, RecallProbe, evaluate_all, evaluate_probes
from evals.playtest_report import (
    RunFacts,
    TurnFacts,
    context_by_range,
    issues_by_turn,
    lag_by_turn,
    markdown,
    own_options,
    recall_use,
    retired_mentions,
    summarize,
    thread_quality,
    world_quality,
    worlds_by_turn,
)


def entity(id: str, kind: str, name: str, **kw: Any) -> EntityRecord:
    return EntityRecord(id=id, kind=kind, name=name, name_norm=normalize_name(name), **kw)


WORLD = entity("w", "world", "世界", data={"scene": {}})
HERO = entity("hero", "character", "林川", is_protagonist=True)
ZHOU = entity("zhou", "character", "老周")
KEY = entity("key", "item", "钥匙")
DOCK = entity("dock", "location", "码头")
HELD = LinkRecord("key", "held_by", "hero")


def change(target: str, before: Any, after: Any) -> RowChange:
    return RowChange(
        target,  # type: ignore[arg-type]
        None if before is None else before.to_json(),
        None if after is None else after.to_json(),
    )


# 第 0 回合：新建码头；第 1 回合：钥匙从林川手里放到码头（第二处位置忘了去掉）；第 2 回合：老周退场
PATCHES = {
    0: [change("entity", None, DOCK)],
    1: [change("link", None, LinkRecord("key", "located_in", "dock", 1))],
    2: [change("entity", ZHOU, EntityRecord(**{**ZHOU.to_json(), "aliases": (), "retired": True}))],
}
FINAL = WorldRecords(
    entities=(
        WORLD,
        HERO,
        EntityRecord(**{**ZHOU.to_json(), "aliases": (), "retired": True}),
        KEY,
        DOCK,
    ),
    links=(HELD, LinkRecord("key", "located_in", "dock", 1)),
)


def test_worlds_are_rebuilt_backwards_from_the_patches() -> None:
    worlds = worlds_by_turn(FINAL, PATCHES, 2)
    assert sorted(worlds) == [-1, 0, 1, 2]
    assert "dock" not in {e.id for e in worlds[-1].entities}
    assert "dock" in {e.id for e in worlds[0].entities}
    assert len(worlds[0].links) == 1 and len(worlds[1].links) == 2
    zhou = {e.id: e for e in worlds[1].entities}["zhou"]
    assert not zhou.retired


def test_new_issues_are_reported_by_turn() -> None:
    worlds = worlds_by_turn(FINAL, PATCHES, 2)
    found = issues_by_turn(worlds)
    assert list(found) == [1]
    assert [i.code for i in found[1]] == ["two_places"]


def test_retired_people_written_again_are_listed() -> None:
    worlds = worlds_by_turn(FINAL, PATCHES, 2)
    turns = [
        TurnFacts(2, "text", "", "老周倒在火里。", 1),
        TurnFacts(3, "option", "", "我想起老周的话。", 2),
    ]
    mentions = retired_mentions(worlds, turns)
    # 退场那一回合写到他不算
    assert [(m.seq, m.name, m.retired_seq) for m in mentions] == [(3, "老周", 2)]


def test_lag_is_measured_when_the_director_writes() -> None:
    turns = [
        TurnFacts(0, "opening", "", "", -1),
        TurnFacts(1, "text", "", "", -1),
        TurnFacts(2, "option", "", "", 0),
        TurnFacts(3, "option", "", "", 2),
    ]
    # 写第 1 回合时开场还没整理（state_seq 是 -1）：落后 1 回合
    assert lag_by_turn(turns) == {1: 1, 2: 1, 3: 0}


def test_summary_and_page() -> None:
    worlds = worlds_by_turn(FINAL, PATCHES, 2)
    turns = [TurnFacts(s, "option", "", "", s - 1, "model") for s in range(3)]
    runs = [
        RunFacts(
            0,
            "director",
            "ok",
            input_tokens=1000,
            cached_tokens=800,
            output_tokens=200,
            latency_ms=2000,
            ttft_ms=400,
        ),
        RunFacts(
            0,
            "state_keeper",
            "ok",
            input_tokens=3000,
            cached_tokens=2500,
            output_tokens=100,
            latency_ms=4000,
            result={
                "model_calls": 2,
                "changes": 3,
                "rejected": [{"tool": "move", "code": "unknown_entity"}],
            },
        ),
        RunFacts(1, "state_keeper", "failed", error_class="timeout"),
    ]
    checks = evaluate_all(
        [Check(2, "retired", ("老周",)), Check(1, "retired", ("老周",))], worlds, 2
    )
    summary = summarize(
        turns, runs, worlds, skipped=[1], final_state_seq=2, checks=checks, protagonist="林川"
    )
    assert summary["turns"] == 3
    # 导演每回合都自己给了选项；检查点过了一个；第 1 回合出了问题
    assert summary["options"] == {"own": 3, "total": 3, "ratio": 1.0, "passed": True}
    assert summary["checks"]["passed"] == 1 and summary["checks"]["total"] == 2
    assert summary["verdict"] == {
        "passed": False,
        "reasons": ["检查点只过了 1 / 2", "1 个回合出现了一致性问题"],
    }
    assert summary["state"]["runs"] == {"ok": 1, "failed": 1}
    assert summary["state"]["errors"] == {"timeout": 1}
    assert summary["state"]["top_rejected"] == [("move:unknown_entity", 1)]
    assert summary["state"]["cache_hit_ratio"] == round(2500 / 3000, 4)
    assert summary["consistency"]["turns_with_new_issues"] == {1: ["two_places"]}
    assert summary["world"]["retired"] == 1
    page = markdown(summary, title="测试", playthrough_id="pt-1")
    assert "pt-1" in page and "跳过的回合：[1]" in page
    assert "**结论：不合格**" in page and "第 1 回合后 retired 老周：“老周”还在" in page


def test_own_options_and_world_quality() -> None:
    turns = [
        TurnFacts(0, "opening", "", "", -1, "model"),
        TurnFacts(1, "text", "", "", 0, "repaired"),
        TurnFacts(2, "ending", "", "", 1, None),
    ]
    assert own_options(turns) == {"own": 1, "total": 2, "ratio": 0.5, "passed": False}
    world = WorldRecords(
        entities=(
            entity("fu", "character", "阿福", first_seq=3, last_seen_seq=3),
            entity("dock", "location", "码头", first_seq=2, last_seen_seq=5),
            entity("step", "location", "石阶", first_seq=4, last_seen_seq=4),
        ),
        facts=(
            FactRecord(id="a", text="林川推开了门"),
            FactRecord(id="b", text="老周欠商会的钱"),
            FactRecord(id="c", text="林川知道了秘密", status="superseded"),
        ),
    )
    assert world_quality(world, protagonist="林川", last_seq=10) == {
        "facts_by_protagonist": 1,
        "facts_by_protagonist_ratio": 0.5,
        "one_turn_characters": 1,
        "one_turn_locations": 1,
    }


def test_threads_are_rebuilt_backwards_too() -> None:
    opened = ThreadRecord(id="t", kind="promise", text="老周答应的事", opened_seq=1)
    closed = ThreadRecord(**{**opened.to_json(), "status": "closed", "closed_seq": 2})
    patches = {
        1: [RowChange("thread", None, opened.to_json())],
        2: [RowChange("thread", opened.to_json(), closed.to_json())],
    }
    worlds = worlds_by_turn(WorldRecords(threads=(closed,)), patches, 2)
    assert worlds[0].threads == () and worlds[0].facts == ()
    assert worlds[1].threads == (opened,) and worlds[2].threads == (closed,)


def test_recall_use_and_probes() -> None:
    runs = [
        RunFacts(seq=5, agent="director", status="ok", ttft_ms=500, result={"recall_before": 0}),
        RunFacts(
            seq=30,
            agent="director",
            status="ok",
            ttft_ms=800,
            result={"recall_before": 20, "tool_rounds": 0},
        ),
        RunFacts(
            seq=31,
            agent="director",
            status="ok",
            ttft_ms=2400,
            result={"recall_before": 20, "tool_rounds": 1},
        ),
    ]
    use = recall_use(runs, {"recall": 2, "lookup": 1})
    assert use["offered_turns"] == 2 and use["used_turns"] == 1 and use["used_ratio"] == 0.5
    assert use["rounds"] == {0: 1, 1: 1}
    assert use["ttft_ms_p50_with_tools"] == 2400 and use["ttft_ms_p50_without_tools"] == 800
    probes = [RecallProbe(31, ("乌鸦",)), RecallProbe(32, ("归雁",))]
    narratives = {31: "我想起来了，火漆上是一只乌鸦。", 32: "我写下了驿站的名字。"}
    right, wrong = evaluate_probes(probes, narratives, {31: 1})
    assert right.passed and right.tool_rounds == 1 and "乌鸦" in right.detail
    assert not wrong.passed and wrong.tool_rounds == 0 and "归雁" in wrong.detail
    summary = summarize(
        [], runs, {-1: WorldRecords()}, skipped=[], final_state_seq=-1, probes=[right, wrong]
    )
    page = markdown(summary, title="召回", playthrough_id="pt")
    assert "召回题：答对 1 / 2" in page and "第 32 回合（错）" in page


def test_stale_threads_and_answers_are_counted() -> None:
    final = WorldRecords(
        threads=(
            ThreadRecord(id="a", kind="mystery", text="谁封的信", opened_seq=3, answer="商会旧派"),
            ThreadRecord(id="b", kind="promise", text="答应带阿苓走", opened_seq=70),
            ThreadRecord(
                id="c", kind="mystery", text="旧的", status="merged", opened_seq=1, closed_seq=9
            ),
        )
    )
    quality = thread_quality(final, last_seq=100)
    assert quality["threads"] == {"mystery:open": 1, "promise:open": 1, "mystery:merged": 1}
    assert quality["threads_stale"] == [{"since": 3, "text": "谁封的信"}]
    assert quality["threads_with_answer"] == 1


def test_context_length_and_chapters_are_reported() -> None:
    runs = [
        RunFacts(
            seq=10,
            agent="director",
            status="ok",
            input_tokens=4000,
            cached_tokens=3000,
            result={"estimated_tokens": 4200},
        ),
        RunFacts(
            seq=40,
            agent="director",
            status="ok",
            input_tokens=6000,
            cached_tokens=5000,
            result={"estimated_tokens": 6100},
        ),
        RunFacts(
            seq=60,
            agent="director",
            status="ok",
            input_tokens=5000,
            cached_tokens=4000,
            result={"estimated_tokens": 5000},
        ),
        RunFacts(seq=33, agent="chapter_writer", status="ok", latency_ms=9000, input_tokens=9000),
        RunFacts(seq=66, agent="chapter_writer", status="failed", error_class="timeout"),
    ]
    assert context_by_range(runs[:3]) == [
        {
            "from": 0,
            "to": 49,
            "estimated_avg": 5150,
            "estimated_max": 6100,
            "input_avg": 5000,
            "cache_hit_ratio": 0.8,
        },
        {
            "from": 50,
            "to": 99,
            "estimated_avg": 5000,
            "estimated_max": 5000,
            "input_avg": 5000,
            "cache_hit_ratio": 0.8,
        },
    ]
    summary = summarize(
        [],
        runs,
        {-1: WorldRecords()},
        skipped=[],
        final_state_seq=-1,
        summaries={"chapter": 2, "synopsis": 1},
    )
    memory = summary["memory"]
    assert memory["runs"] == {"ok": 1, "failed": 1} and memory["errors"] == {"timeout": 1}
    page = markdown(summary, title="章节", playthrough_id="pt")
    assert "## 章节整理" in page and "第 50–99 回合：5000 / 5000，5000，0.8" in page
