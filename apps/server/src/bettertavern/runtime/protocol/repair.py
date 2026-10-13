"""导演输出的修复阶梯（解析器之后的部分）。

① 叙述标签没闭合但流正常结束，整段当叙述；② 选项用正则从叙述之后的文本里提取
（①② 在 DirectorStreamParser 里完成）；③ 少于 2 个选项就调用一次 OptionsRepair
（小模型、非流式、限时 5 秒）；④ 仍然失败就用本地化的通用默认选项。叙述缺失则直接失败。
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
    options: tuple[str, str]
    stage: ParseStage
    repairs: tuple[str, ...]
    notes: tuple[str, ...]


async def finalize_director_output(
    parse: DirectorParse,
    *,
    repair: OptionsRepairFn | None,
    fallback: tuple[str, str],
    timeout: float = 5.0,
) -> DirectorOutcome:
    if parse.stage is ParseStage.FAILED or not parse.narrative.strip():
        raise NarrativeMissing("导演没有产出叙述")
    notes = list(parse.notes)
    existing = list(parse.options)
    if len(existing) >= OPTION_COUNT:
        return DirectorOutcome(
            narrative=parse.narrative,
            options=(existing[0], existing[1]),
            stage=parse.stage,
            repairs=parse.repairs,
            notes=tuple(notes),
        )
    if repair is not None:
        try:
            async with asyncio.timeout(timeout):
                extra = await repair(parse.narrative, tuple(existing))
            merged = normalize_options([*existing, *extra], limit=OPTION_COUNT)
            if len(merged) == OPTION_COUNT:
                return DirectorOutcome(
                    narrative=parse.narrative,
                    options=(merged[0], merged[1]),
                    stage=ParseStage.REPAIRED,
                    repairs=parse.repairs,
                    notes=tuple(notes),
                )
            notes.append("OptionsRepair 没有给出 2 个有效选项")
        except TimeoutError:
            notes.append(f"OptionsRepair 超过 {timeout:g} 秒")
        except Exception as exc:  # 修复是尽力而为，任何失败都退到默认选项
            notes.append(f"OptionsRepair 失败：{type(exc).__name__}")
    merged = normalize_options([*existing, *fallback], limit=OPTION_COUNT)
    if len(merged) < OPTION_COUNT:  # 已有选项恰好与默认选项重复
        merged = list(fallback)
    return DirectorOutcome(
        narrative=parse.narrative,
        options=(merged[0], merged[1]),
        stage=ParseStage.FALLBACK,
        repairs=parse.repairs,
        notes=tuple(notes),
    )
