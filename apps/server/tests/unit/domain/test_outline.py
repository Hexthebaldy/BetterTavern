"""大纲的整理规则：截长、去重，完成的拍不能改回去，完成和跳过的只留最近两拍，只有一拍进行中；
导演看到的切片。"""

from __future__ import annotations

from bettertavern.domain.memory.outline import (
    MAX_BEATS,
    Beat,
    Outline,
    outline_from_json,
    settle,
    slice_of,
)

OLD = Outline(
    premise="信使卷进商会旧账",
    beats=[
        Beat(id="b1", status="done", intent="得知火漆的来历"),
        Beat(id="b2", status="active", intent="把信送到分号", done_when="见到管事"),
        Beat(id="b3", intent="码头大火"),
    ],
    constraints=["第 4 拍之前不揭晓放火的人"],
)


def test_done_beats_stay_done_and_one_beat_is_active() -> None:
    new = Outline(
        premise="  信使卷进\n商会旧账  ",
        beats=[
            Beat(id="b1", status="pending", intent="得知火漆的来历"),  # 想改回没完成
            Beat(id="b2", status="active", intent="把信送到分号"),
            Beat(id="b3", status="active", intent="码头大火"),  # 两拍进行中
            Beat(id="b4", status="whatever", intent="揭晓放火的人"),
        ],
        constraints=["", "不能让老周复活"],
    )
    settled = settle(new, OLD)
    assert settled.premise == "信使卷进 商会旧账"
    assert [b.status for b in settled.beats] == ["done", "active", "pending", "pending"]
    assert settled.constraints == ["不能让老周复活"]


def test_only_the_latest_two_finished_beats_are_kept() -> None:
    finished = [Beat(id=f"b{i}", status="done", intent=f"第{i}拍") for i in range(1, 5)]
    pending = [Beat(id=f"n{i}", intent=f"往后第{i}拍") for i in range(1, MAX_BEATS)]
    settled = settle(
        Outline(
            premise="p", beats=[*finished, Beat(id="s", status="skipped", intent="绕过"), *pending]
        )
    )
    # 更早的完成拍去掉，待写的拍不会因为完成拍积得多而被挤掉
    assert [b.id for b in settled.beats[:3]] == ["b4", "s", "n1"]
    assert settled.beats[2].status == "active"
    assert len(settled.beats) == MAX_BEATS and settled.beats[-1].id == f"n{MAX_BEATS - 2}"


def test_the_first_pending_beat_becomes_active_when_none_is() -> None:
    new = Outline(
        premise="p",
        beats=[Beat(id="b1", status="done", intent="一"), Beat(id="b2", intent="二")],
    )
    assert [b.status for b in settle(new).beats] == ["done", "active"]


def test_long_outlines_are_cut_and_duplicate_ids_renamed() -> None:
    new = Outline(
        premise="p" * 500,
        beats=[Beat(id="b1", intent="拍" * 500) for _ in range(MAX_BEATS + 3)],
    )
    settled = settle(new)
    assert len(settled.premise) == 200 and len(settled.beats) == MAX_BEATS
    assert len({b.id for b in settled.beats}) == MAX_BEATS
    assert len(settled.beats[0].intent) == 200


def test_slice_shows_the_current_and_next_beat() -> None:
    view = slice_of(OLD)
    assert view.current is not None and view.current.id == "b2"
    assert view.upcoming is not None and view.upcoming.id == "b3"
    assert view.constraints == ("第 4 拍之前不揭晓放火的人",)
    assert outline_from_json(OLD.model_dump()) == OLD
    assert outline_from_json({"premise": "缺了拍"}) is None and outline_from_json(None) is None
