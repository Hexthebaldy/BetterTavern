"""导演输出的修复阶梯（解析器之后的部分）。

① 叙述标签没闭合但流正常结束，整段当叙述；② 选项用正则从叙述之后的文本里提取
（①② 在 DirectorStreamParser 里完成）；③ 少于 2 个选项就调用 OptionsRepair 补
（小模型、非流式、每次限时 5 秒），失败再试一次；④ 两次都没补齐就不补了，这一回合选项不全，
玩家自己写下一步（不用固定的默认选项）。叙述缺失则直接失败。
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from bettertavern.domain.story.options import OPTION_COUNT, normalize_options

from .director_parser import DirectorParse, ParseStage

# (叙述, 已有的有效选项) → 新选项
OptionsRepairFn = Callable[[str, Sequence[str]], Awaitable[Sequence[str]]]


class NarrativeMissing(Exception):
    """导演没有产出叙述，回合按失败处理。"""


@dataclass(frozen=True, slots=True)
class DirectorOutcome:
    narrative: str
    options: tuple[str, ...]  # 0 到 2 个；不足 2 个时 stage 是 MISSING
    stage: ParseStage
    repairs: tuple[str, ...]
    notes: tuple[str, ...]


async def finalize_director_output(
    parse: DirectorParse,
    *,
    repair: OptionsRepairFn | None,
    attempts: int = 2,
    timeout: float = 5.0,
) -> DirectorOutcome:
    """导演给的选项不足 2 个时调 OptionsRepair 补，失败就再试，最多 attempts 次
    （每次限时 timeout 秒）。都没补齐时不再补：保留导演给出的有效选项（0 或 1 个），
    玩家自己写下一步。"""
    if parse.stage is ParseStage.FAILED or not parse.narrative.strip():
        raise NarrativeMissing("the director produced no narrative")
    notes = list(parse.notes)
    options = normalize_options(parse.options, limit=OPTION_COUNT)
    if len(options) >= OPTION_COUNT:
        return DirectorOutcome(
            narrative=parse.narrative,
            options=tuple(options),
            stage=parse.stage,
            repairs=parse.repairs,
            notes=tuple(notes),
        )
    for _ in range(attempts if repair is not None else 0):
        assert repair is not None
        try:
            async with asyncio.timeout(timeout):
                extra = await repair(parse.narrative, tuple(options))
            options = normalize_options([*options, *extra], limit=OPTION_COUNT)
            if len(options) == OPTION_COUNT:
                return DirectorOutcome(
                    narrative=parse.narrative,
                    options=tuple(options),
                    stage=ParseStage.REPAIRED,
                    repairs=parse.repairs,
                    notes=tuple(notes),
                )
            notes.append("OptionsRepair did not produce 2 valid choices")
        except TimeoutError:
            notes.append(f"OptionsRepair took longer than {timeout:g} s")
        except Exception as exc:  # 补选项是尽力而为：出错就再试，次数用完就不补了
            notes.append(f"OptionsRepair failed: {type(exc).__name__}")
    return DirectorOutcome(
        narrative=parse.narrative,
        options=tuple(options),
        stage=ParseStage.MISSING,
        repairs=parse.repairs,
        notes=tuple(notes),
    )
