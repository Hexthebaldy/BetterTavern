"""在哪里切章：超过软线以后的下一个场景结束处，一直没有场景结束就到硬线时切。"""

from __future__ import annotations

import pytest

from bettertavern.domain.memory.chapters import ChapterRule, TurnSize, chapter_end, raw_start

RULE = ChapterRule(soft_tokens=100, hard_tokens=200)


def turns(*items: tuple[int, bool], start: int = 5) -> list[TurnSize]:
    return [TurnSize(start + i, tokens, ended) for i, (tokens, ended) in enumerate(items)]


def test_cut_at_the_first_scene_end_after_the_soft_line() -> None:
    # 第 6 回合场景结束，但还没到软线；第 8 回合过了软线以后才遇到场景结束
    assert chapter_end(turns((40, False), (40, True), (40, False), (40, True)), RULE) == 8


def test_cut_on_the_turn_that_crosses_the_soft_line_if_its_scene_ends() -> None:
    assert chapter_end(turns((60, False), (60, True)), RULE) == 6


def test_hard_line_cuts_without_a_scene_end() -> None:
    assert chapter_end(turns((90, False), (90, False), (90, False)), RULE) == 7


def test_not_yet() -> None:
    assert chapter_end(turns((60, True), (30, False)), RULE) is None
    assert chapter_end([], RULE) is None


def test_rule_needs_sensible_lines() -> None:
    with pytest.raises(ValueError):
        ChapterRule(soft_tokens=300, hard_tokens=200)


def test_raw_turns_start_two_turns_before_the_end_of_the_last_chapter() -> None:
    assert raw_start(-1) == 0
    assert raw_start(0) == 0
    assert raw_start(40) == 39
