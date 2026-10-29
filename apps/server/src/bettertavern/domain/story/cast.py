"""多角色剧本（F4，docs/cast.md）：这一局有哪几个角色、每一段是谁写的、这一回合谁说话。

- 剧本里有两张以上的卡时，开局搭世界时把每张卡的名字和封面记成这一局的角色（playthrough_cast），
  位置就是卡在剧本里的顺序（和开局时卡的原文快照一一对应）。之后改剧本不影响这一局。
  以前开的局没有角色，照旧由导演一个人写。
- 多角色的局，普通回合由几个人分别写：每个说话的角色单独请求一次模型，旁白（导演）写环境、
  路人和主角独自行动的结果。每一段记成一个 Segment；回合的叙述是几段拼起来、每段前面带名字的全文，
  后台整理和召回直接读它。
- 谁说话（choose_speakers），从上往下看，哪一条先满足就按哪一条：
  1. 玩家点了名：按点的顺序；
  2. 玩家的行动里写了谁的名字：按名字出现的先后；
  3. 在场的角色里最久没开口的一个；场上没有角色时由旁白写。不知道谁在场（闪电模式没有世界状态）时
     在所有角色里挑。玩家这一回合不行动、让他们接着说时，不挑上一回合最后说话的那个（只剩他时除外）。
  “先不出场”的角色不会被挑中，点名也不算。一回合说话的人数不设上限。
  规则是确定的（不随机）：同样的情况结果一样，方便测试和重放。
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from bettertavern.domain.world.names import normalize_name

# 旁白（导演）在段落、点名里的写法
NARRATOR: None = None
MIN_CAST = 2  # 两张卡以上才是多角色
MIN_NAME_CHARS = 2  # 只有一个字的名字不参与“行动里提到了谁”，免得误中

Speaker = int | None


@dataclass(frozen=True, slots=True)
class CastMember:
    position: int  # 剧本里第几张卡，从 0 开始
    name: str
    muted: bool = False  # 先不出场


@dataclass(frozen=True, slots=True)
class Segment:
    """一个人写的一段：speaker 是角色的位置，旁白是 None。notes 是这一段的隐藏备注。"""

    speaker: Speaker
    text: str
    notes: str = ""

    def to_json(self) -> dict[str, Any]:
        return {"speaker": self.speaker, "text": self.text}


def is_group(cast: Sequence[CastMember]) -> bool:
    return len(cast) >= MIN_CAST


def parse_speaker(value: Any) -> Speaker:
    """库里、请求里的一个说话人：整数是角色的位置，null 是旁白；别的都不认。"""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("speaker must be an integer or null")
    return value


def segments_from_json(data: Any) -> tuple[Segment, ...]:
    """turns.segments → 段落；格式不对的项跳过。"""
    if not isinstance(data, list):
        return ()
    result: list[Segment] = []
    for item in data:
        if not isinstance(item, Mapping) or not isinstance(item.get("text"), str):
            continue
        try:
            speaker = parse_speaker(item.get("speaker"))
        except ValueError:
            continue
        result.append(Segment(speaker=speaker, text=item["text"]))
    return tuple(result)


def speaker_name(cast: Sequence[CastMember], speaker: Speaker, narrator: str) -> str:
    if speaker is None:
        return narrator
    member = next((m for m in cast if m.position == speaker), None)
    return member.name if member is not None else narrator


def join_segments(
    segments: Sequence[Segment], cast: Sequence[CastMember], *, header: str, narrator: str
) -> str:
    """几段拼成回合的叙述：每段前面一行名字（header 形如“【{name}】”），段与段之间空一行。"""
    return "\n\n".join(
        f"{header.format(name=speaker_name(cast, s.speaker, narrator))}\n{s.text}" for s in segments
    )


def join_notes(segments: Sequence[Segment], cast: Sequence[CastMember], *, narrator: str) -> str:
    """几段的隐藏备注拼在一起，每条前面带上是谁写的。"""
    return "\n".join(
        f"{speaker_name(cast, s.speaker, narrator)}: {s.notes.strip()}"
        for s in segments
        if s.notes.strip()
    )


def strip_header(text: str, names: Iterable[str], header: str) -> str:
    """模型照着历史在开头写了一行名字（“【阿苓】”）时去掉它和后面的空白。"""
    stripped = text.lstrip()
    first, newline, rest = stripped.partition("\n")
    headers = {normalize_name(header.format(name=n)) for n in names if n}
    if newline and normalize_name(first) in headers:
        return rest.lstrip()
    return text


def _first_mention(keys: Sequence[str], haystack: str) -> int | None:
    found = [i for k in keys if len(k) >= MIN_NAME_CHARS and (i := haystack.find(k)) >= 0]
    return min(found) if found else None


def choose_speakers(
    cast: Sequence[CastMember],
    *,
    picked: Sequence[Speaker] = (),
    action_text: str = "",
    present: Collection[int] | None = None,
    last_spoken: Mapping[int, int] | None = None,
    aliases: Mapping[int, Sequence[str]] | None = None,
    continuing: bool = False,
    previous: Sequence[Speaker] = (),
) -> list[Speaker]:
    """这一回合谁说话、按什么顺序（规则见模块说明）。

    picked：玩家点的名（角色的位置，旁白是 None）；present：在场角色的位置，None 表示不知道；
    last_spoken：每个角色最近一次说话是第几回合（没说过的不在里面）；aliases：除了名字以外还认哪些叫法；
    continuing：玩家这一回合不行动；previous：上一回合说话的人，按顺序。"""
    by_position = {m.position: m for m in cast}
    active = [m for m in cast if not m.muted]

    allowed = [s for s in picked if s is None or (s in by_position and not by_position[s].muted)]
    chosen = list(dict.fromkeys(allowed))
    if chosen:
        return chosen

    haystack = normalize_name(action_text) if action_text else ""
    if haystack:
        hits: list[tuple[int, int]] = []
        for member in active:
            keys = [normalize_name(member.name)]
            keys += [normalize_name(a) for a in (aliases or {}).get(member.position, ())]
            index = _first_mention(list(dict.fromkeys(keys)), haystack)
            if index is not None:
                hits.append((index, member.position))
        if hits:
            return [position for _, position in sorted(hits)]

    candidates = [m for m in active if present is None or m.position in present]
    if continuing and len(candidates) > 1:
        last = next((s for s in reversed(previous) if s is not None), None)
        candidates = [m for m in candidates if m.position != last]
    if not candidates:
        return [NARRATOR]
    spoken = last_spoken or {}
    quietest = min(candidates, key=lambda m: (spoken.get(m.position, -1), m.position))
    return [quietest.position]
