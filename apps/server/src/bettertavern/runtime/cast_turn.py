"""多角色的局的一个普通回合（TurnRunner 用，docs/cast.md）。

1. 按规则定这一回合谁说话（domain/story/cast.py 的 choose_speakers，不调模型）；
2. 一个接一个写：每个人单独请求一次导演的模型（执行循环和普通回合一样，可以用召回工具），
   上下文只有最后一条消息不同（context/assembler.py 的 role）。每个人开写前推一条 speaker.started，
   之后的 narrative.delta 都是他这一段的；
3. 模型照着历史在开头写了一行名字（“【阿苓】”）时去掉它，推给玩家的和存下来的一样；
4. 都写完以后补两个选项（和导演没给选项时一样，用补选项的小请求）；
5. 叙述是几段拼起来的全文（每段前面一行名字），每一段是谁写的另存在 turns.segments。

中间任何一个人写失败，这一回合按失败算：前面写好的几段加上没写完的半段存成草稿，
已经花掉的几次请求都记进 agent_runs。重试时所有人重写。
"""

from __future__ import annotations

import dataclasses
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

import structlog

from bettertavern.domain.story.cast import (
    Segment,
    Speaker,
    choose_speakers,
    join_segments,
    speaker_name,
    strip_header,
)
from bettertavern.domain.story.mode import is_lightning
from bettertavern.domain.world.names import normalize_name

from .context.cast import CastRole, cast_aliases, cast_entities, present_positions
from .director_loop import sum_usage
from .ports import AgentRunRecord, TurnContext
from .protocol.director_parser import MISSING_OPTIONS, ParseStage
from .turn_finalize import TurnFailed, director_run, narrative_missing
from .turn_stream import Generation, Publish

log = structlog.get_logger(__name__)

# 写某个人的一段：(这一次写谁, 推送) → 导演这一次调用的结果
Generate = Callable[[CastRole, Publish], Awaitable[Generation]]


@dataclasses.dataclass(frozen=True)
class CastResult:
    segments: tuple[Segment, ...]
    narrative: str
    runs: list[AgentRunRecord]
    generations: list[Generation]

    @property
    def usage(self) -> Any:
        return sum_usage([g.usage for g in self.generations])


def speakers_for(ctx: TurnContext) -> list[Speaker]:
    """这一回合谁说话：在场的角色取自世界状态；闪电模式没有世界状态，一个角色都对不上时也当作不知道。"""
    present: set[int] | None = None
    if not is_lightning(ctx.header.mode) and cast_entities(ctx.world, ctx.cast):
        present = present_positions(ctx.world, ctx.cast)
    last_spoken: dict[int, int] = {}
    for turn in ctx.history:
        for speaker in turn.speakers:
            if speaker is not None:
                last_spoken[speaker] = turn.seq
    continuing = ctx.action.source == "continue"
    return choose_speakers(
        ctx.cast,
        picked=ctx.action.speakers,
        action_text="" if continuing else ctx.action.text,
        present=present,
        last_spoken=last_spoken,
        aliases=cast_aliases(ctx.world, ctx.cast),
        continuing=continuing,
        previous=ctx.history[-1].speakers if ctx.history else (),
    )


class HeaderFilter:
    """一段开头那一行名字不推给玩家：先攒着，看出第一行是不是名字以后再推。"""

    def __init__(self, publish: Publish, names: Sequence[str], header: str) -> None:
        self._publish = publish
        self._names = list(names)
        self._header = header
        self._headers = {normalize_name(header.format(name=n)) for n in names if n}
        self._limit = max((len(header.format(name=n)) for n in names), default=0) + 4
        self._buffer = ""
        self._decided = False

    def _ready(self) -> str | None:
        """该推出去的文字；还看不出来时是 None。"""
        text = self._buffer.lstrip()
        first, newline, rest = text.partition("\n")
        if newline:
            if normalize_name(first) not in self._headers:
                return self._buffer
            rest = rest.lstrip()
            return rest or None
        return self._buffer if len(text) > self._limit else None

    async def publish(self, event: str, data: dict[str, Any]) -> None:
        if event == "narrative.delta" and not self._decided:
            self._buffer += str(data.get("text", ""))
            ready = self._ready()
            if ready is not None:
                self._decided = True
                await self._publish(event, {"text": ready})
            return
        await self.flush()
        await self._publish(event, data)

    async def flush(self) -> None:
        if self._decided:
            return
        self._decided = True
        text = strip_header(self._buffer, self._names, self._header)
        if text:
            await self._publish("narrative.delta", {"text": text})


async def write_segments(
    ctx: TurnContext,
    speakers: Sequence[Speaker],
    generate: Generate,
    publish: Publish,
    *,
    header: str,
    narrator: str,
) -> CastResult:
    """一个接一个写；失败时抛 TurnFailed，草稿是已经写好的几段加上没写完的半段。"""
    names = [*(m.name for m in ctx.cast), narrator]
    segments: list[Segment] = []
    runs: list[AgentRunRecord] = []
    generations: list[Generation] = []

    def failed(exc: TurnFailed, speaker: Speaker) -> TurnFailed:
        draft = list(segments)
        partial = strip_header(exc.failure.narrative, names, header).strip()
        if partial:
            draft.append(Segment(speaker, partial))
        failure = dataclasses.replace(
            exc.failure,
            narrative=join_segments(draft, ctx.cast, header=header, narrator=narrator),
            segments=tuple(draft),
            partial=bool(draft),
            runs=[*runs, *exc.failure.runs],
        )
        return TurnFailed(failure)

    for index, speaker in enumerate(speakers):
        await publish(
            "speaker.started",
            {"index": index, "speaker": speaker, "name": speaker_name(ctx.cast, speaker, narrator)},
        )
        filter_ = HeaderFilter(publish, names, header)
        try:
            generation = await generate(CastRole(speaker, tuple(segments)), filter_.publish)
            await filter_.flush()
        except TurnFailed as exc:
            await filter_.flush()  # 攒着还没推的半段也推给玩家，和存下的草稿一致
            raise failed(exc, speaker) from exc
        parse = generation.parse
        text = strip_header(parse.narrative, names, header).strip()
        if parse.stage is ParseStage.FAILED or not text:
            raise failed(narrative_missing(generation), speaker)
        segments.append(Segment(speaker, text, parse.director_notes))
        generations.append(generation)
        runs.append(
            director_run(
                generation,
                status="ok",
                extra={
                    "speaker": speaker,
                    "stage": parse.stage.value,
                    "repairs": [r for r in parse.repairs if r != MISSING_OPTIONS],
                    "dropped_options": len(parse.options),
                    "notes": list(parse.notes)[:10],
                },
            )
        )
    log.info(
        "cast.written",
        speakers=list(speakers),
        chars=[len(s.text) for s in segments],
    )
    return CastResult(
        segments=tuple(segments),
        narrative=join_segments(segments, ctx.cast, header=header, narrator=narrator),
        runs=runs,
        generations=generations,
    )
