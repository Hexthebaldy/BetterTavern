from __future__ import annotations

import asyncio
from collections.abc import Sequence

import pytest

from bettertavern.runtime.protocol.director_parser import ParseStage, parse_director_text
from bettertavern.runtime.protocol.repair import NarrativeMissing, finalize_director_output

pytestmark = pytest.mark.anyio


async def test_compliant_output_needs_no_repair() -> None:
    parse = parse_director_text(
        "<narrative>门开了。</narrative><options>1. 进去\n2. 离开</options>"
    )

    async def repair(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        raise AssertionError("不应调用 OptionsRepair")

    outcome = await finalize_director_output(parse, repair=repair)
    assert outcome.options == ("进去", "离开")
    assert outcome.stage is ParseStage.OK


async def test_repair_fills_missing_options_keeping_existing_first() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative><options>1. 进去</options>")
    calls: list[tuple[str, tuple[str, ...]]] = []

    async def repair(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        calls.append((narrative, tuple(existing)))
        return ["进去", "先敲门", "离开"]

    outcome = await finalize_director_output(parse, repair=repair)
    assert calls == [("门开了。", ("进去",))]
    assert outcome.options == ("进去", "先敲门")
    assert outcome.stage is ParseStage.REPAIRED


async def test_a_failed_repair_is_tried_once_more() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative>")
    calls = 0

    async def flaky(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("boom")
        return ["进去", "离开"]

    outcome = await finalize_director_output(parse, repair=flaky)
    assert calls == 2
    assert outcome.options == ("进去", "离开") and outcome.stage is ParseStage.REPAIRED


async def test_second_try_keeps_what_the_first_produced() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative>")
    seen: list[tuple[str, ...]] = []

    async def one_at_a_time(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        seen.append(tuple(existing))
        return ["进去"] if not existing else ["离开"]

    outcome = await finalize_director_output(parse, repair=one_at_a_time)
    assert seen == [(), ("进去",)]
    assert outcome.options == ("进去", "离开")


async def test_two_failures_leave_the_options_missing() -> None:
    # 两次都没补齐：不用固定的默认选项，保留导演给的那一个，玩家自己写下一步
    parse = parse_director_text("<narrative>门开了。</narrative><options>1. 进去</options>")
    calls = 0

    async def slow(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        nonlocal calls
        calls += 1
        await asyncio.sleep(1)
        return ["a", "b"]

    outcome = await finalize_director_output(parse, repair=slow, timeout=0.05)
    assert calls == 2
    assert outcome.options == ("进去",)
    assert outcome.stage is ParseStage.MISSING
    assert sum("took longer than" in note for note in outcome.notes) == 2


async def test_no_repair_function_leaves_the_options_missing() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative>")
    outcome = await finalize_director_output(parse, repair=None)
    assert outcome.options == () and outcome.stage is ParseStage.MISSING


async def test_missing_narrative_raises() -> None:
    with pytest.raises(NarrativeMissing):
        await finalize_director_output(parse_director_text(""), repair=None)
