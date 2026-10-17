from __future__ import annotations

import asyncio
from collections.abc import Sequence

import pytest

from bettertavern.domain.story.options import fallback_options
from bettertavern.runtime.protocol.director_parser import ParseStage, parse_director_text
from bettertavern.runtime.protocol.repair import NarrativeMissing, finalize_director_output

pytestmark = pytest.mark.anyio
FALLBACK = fallback_options("zh")


async def test_compliant_output_needs_no_repair() -> None:
    parse = parse_director_text(
        "<narrative>门开了。</narrative><options>1. 进去\n2. 离开</options>"
    )

    async def repair(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        raise AssertionError("不应调用 OptionsRepair")

    outcome = await finalize_director_output(parse, repair=repair, fallback=FALLBACK)
    assert outcome.options == ("进去", "离开")
    assert outcome.stage is ParseStage.OK


async def test_repair_fills_missing_options_keeping_existing_first() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative><options>1. 进去</options>")
    calls: list[tuple[str, tuple[str, ...]]] = []

    async def repair(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        calls.append((narrative, tuple(existing)))
        return ["进去", "先敲门", "离开"]

    outcome = await finalize_director_output(parse, repair=repair, fallback=FALLBACK)
    assert calls == [("门开了。", ("进去",))]
    assert outcome.options == ("进去", "先敲门")
    assert outcome.stage is ParseStage.REPAIRED


async def test_repair_timeout_falls_back() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative>")

    async def slow(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        await asyncio.sleep(1)
        return ["a", "b"]

    outcome = await finalize_director_output(parse, repair=slow, fallback=FALLBACK, timeout=0.05)
    assert outcome.options == FALLBACK
    assert outcome.stage is ParseStage.FALLBACK
    assert any("took longer than" in note for note in outcome.notes)


async def test_repair_error_falls_back() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative>")

    async def broken(narrative: str, existing: Sequence[str]) -> Sequence[str]:
        raise RuntimeError("boom")

    outcome = await finalize_director_output(parse, repair=broken, fallback=FALLBACK)
    assert outcome.stage is ParseStage.FALLBACK


async def test_no_repair_function_uses_fallback_after_existing_option() -> None:
    parse = parse_director_text("<narrative>门开了。</narrative><options>1. 进去</options>")
    outcome = await finalize_director_output(parse, repair=None, fallback=FALLBACK)
    assert outcome.options == ("进去", FALLBACK[0])


async def test_missing_narrative_raises() -> None:
    with pytest.raises(NarrativeMissing):
        await finalize_director_output(parse_director_text(""), repair=None, fallback=FALLBACK)
