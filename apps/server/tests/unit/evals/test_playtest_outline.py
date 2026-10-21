"""剧本试玩里的大纲分析：修订的列表、按回合段的检查（改了几次、改出来的大纲有没有跟上玩家）。"""

from __future__ import annotations

from evals.playtest_outline import (
    OutlineWindow,
    outline_lines,
    outline_summary,
    parse_windows,
    revision_from_row,
)
from evals.playtest_report import RunFacts


def outline(premise: str, *beats: tuple[str, str]) -> dict[str, object]:
    return {
        "premise": premise,
        "beats": [
            {"id": f"b{i}", "status": status, "intent": intent}
            for i, (status, intent) in enumerate(beats, 1)
        ],
        "constraints": [],
    }


REVISIONS = [
    revision_from_row(0, True, outline("把信送到北境", ("active", "甩掉盯梢")), ""),
    revision_from_row(
        8, True, outline("把信送到北境", ("done", "甩掉盯梢"), ("active", "去驿站")), "出镇了"
    ),
    revision_from_row(12, False, None, "只是岔开"),
    revision_from_row(
        25,
        True,
        outline("留在镇上开一家渔具铺", ("skipped", "去驿站"), ("active", "租下铺面")),
        "玩家不送信了",
    ),
]


def test_windows_are_parsed_from_the_scenario() -> None:
    windows = parse_windows(
        [
            {"from": 1, "to": 20, "max_changes": 4},
            {"from": 21, "to": 40, "min_changes": 1, "mentions": ["渔具"]},
        ]
    )
    assert windows == [
        OutlineWindow(1, 20, max_changes=4),
        OutlineWindow(21, 40, min_changes=1, mentions=("渔具",)),
    ]


def test_windows_count_changes_and_look_for_the_players_new_direction() -> None:
    windows = [
        OutlineWindow(0, 20, max_changes=0),  # 第一版不算“改”，第 8 回合那次算
        OutlineWindow(21, 40, min_changes=1, mentions=("渔具",)),
        OutlineWindow(41, 60, min_changes=1, mentions=("渔具",)),  # 段末用的还是第 25 回合那版
        OutlineWindow(0, 20, mentions=("酒馆",)),
    ]
    runs = [
        RunFacts(0, "outline_writer", "ok", input_tokens=900, cached_tokens=0, latency_ms=4000),
        RunFacts(8, "outline_writer", "failed", error_class="timeout"),
        RunFacts(8, "director", "ok"),
    ]
    summary = outline_summary(REVISIONS, [(7, "出镇了"), (24, "玩家不送信了")], runs, windows)
    assert summary["first_seq"] == 0 and summary["revised"] == 2 and summary["kept"] == 1
    assert summary["runs"] == {"ok": 1, "failed": 1} and summary["errors"] == {"timeout": 1}
    assert summary["input_tokens"] == 900 and summary["latency_ms_p50"] == 4000
    results = summary["checks"]["results"]
    assert [r["passed"] for r in results] == [False, True, False, False]
    assert results[0]["detail"] == "改了 1 次，至多 0 次"
    assert results[2]["detail"] == "只改了 0 次，至少要 1 次"
    assert results[3]["detail"] == "第 20 回合时的大纲里没有提到：酒馆"
    assert summary["revisions"][3]["active"] == "租下铺面"
    page = "\n".join(outline_lines(summary))
    assert "之后改了 2 次，不改 1 次" in page
    assert "第 25 回合：改，租下铺面；玩家不送信了" in page
    assert "第 0 回合：改，甩掉盯梢；（第一版）" in page
    assert "大纲检查：通过 1 / 4" in page


def test_no_outline_yet() -> None:
    summary = outline_summary([], [], [])
    assert summary["first_seq"] is None and summary["revised"] == 0
    assert "- 还没有大纲" in outline_lines(summary)
