"""闪电模式按长度压缩：阈值、压到第几回合、原文从哪里开始（domain/memory/lightning.py）。"""

from __future__ import annotations

from bettertavern.domain.memory.lightning import (
    RawTurn,
    compress_end,
    compress_threshold,
    raw_start,
)


def turns(*tokens: int, first: int = 0) -> list[RawTurn]:
    return [RawTurn(first + i, t) for i, t in enumerate(tokens)]


def test_threshold_is_capped_by_half_the_window() -> None:
    assert compress_threshold(128_000) == 12_000
    assert compress_threshold(20_000) == 10_000
    assert compress_threshold(128_000, cap=500) == 500


def test_nothing_is_compressed_below_the_threshold() -> None:
    assert compress_end(turns(3000, 3000, 3000), 12_000) is None


def test_the_recent_turns_are_kept_and_the_rest_compressed() -> None:
    # 留最近至少 3000 token、2 回合：第 2、3、4 回合留着（1000 + 1500 + 1000），第 0、1 回合压掉
    assert compress_end(turns(5000, 5000, 1000, 1500, 1000), 12_000) == 1
    # 最近两回合就够 3000 token：只留两回合
    assert compress_end(turns(5000, 5000, 4000, 4000, first=10), 12_000) == 11


def test_at_least_the_last_turns_stay_even_if_they_are_long() -> None:
    assert compress_end(turns(13_000), 12_000) is None
    assert compress_end(turns(7000, 7000), 12_000) is None
    assert compress_end(turns(500, 7000, 7000), 12_000) == 0


def test_raw_text_starts_right_after_the_synopsis() -> None:
    assert raw_start(-1) == 0
    assert raw_start(9) == 10
