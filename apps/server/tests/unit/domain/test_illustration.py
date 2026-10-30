"""故事配图的规则（docs/illustrations.md）：画风、“想看什么”、哪些回合能画、多久算没画完。"""

from __future__ import annotations

from bettertavern.domain.story.illustration import (
    DEADLINE_S,
    MAX_REQUEST_CHARS,
    can_draw,
    clean_request,
    effective_status,
    normalize_style,
    time_left,
)


def test_unknown_styles_mean_no_style() -> None:
    assert normalize_style("anime") == "anime"
    assert normalize_style(" ink ") == "ink"
    assert normalize_style("cyberpunk") == ""
    assert normalize_style(None) == ""


def test_request_is_trimmed_and_capped() -> None:
    assert clean_request("  沈知微的特写\x00 ") == "沈知微的特写"
    assert clean_request(None) == ""
    assert len(clean_request("字" * 500)) == MAX_REQUEST_CHARS


def test_only_finished_turns_can_be_drawn() -> None:
    assert can_draw("replied") and can_draw("committed")
    for status in ("generating", "failed", "archived"):
        assert not can_draw(status)


def test_pending_too_long_reads_as_timed_out() -> None:
    assert effective_status("pending", 10) == ("pending", None)
    assert effective_status("pending", DEADLINE_S + 1) == ("failed", "timeout")
    # 画好的、失败的不受时限影响
    assert effective_status("ready", DEADLINE_S * 10) == ("ready", None)
    assert effective_status("failed", 5) == ("failed", None)


def test_time_left_counts_the_wait_in_the_queue() -> None:
    assert time_left(0) == DEADLINE_S
    assert time_left(DEADLINE_S - 30) == 30
    assert time_left(DEADLINE_S + 30) == 0
