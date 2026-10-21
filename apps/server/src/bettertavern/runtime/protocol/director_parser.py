"""导演输出协议的增量解析器。

协议是带分隔标签的纯文本（不用 JSON：叙述要边生成边显示，标签天然支持增量，坏了也能局部抢救）：

    <narrative>
    叙述正文
    </narrative>
    <options>
    1. 选项一
    2. 选项二
    </options>
    <director-notes>
    导演写给后台的备注（可选，玩家看不到）
    </director-notes>

状态机 SEEK_NARRATIVE → IN_NARRATIVE → SEEK_OPTIONS → IN_OPTIONS → DONE；任何叙述之外的地方遇到
<director-notes> 就进 IN_NOTES，读完回到原来的状态。备注一个字都不推给玩家，单独放在解析结果里。
- 标签可能被拆在两个 chunk 里：缓冲尾部如果可能是某个标签的前缀，就先不输出；
- 标签之外的文字和 <think> 块直接丢弃；
- 叙述的首尾空白不输出，所以 feed()/finish() 吐出的片段拼起来正好等于最终叙述
  （只有“选项混进了叙述”这种抢救情况例外，此时 rewritten=True）。
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum, StrEnum

from bettertavern.domain.story.options import normalize_options

NARRATIVE_OPEN = "<narrative>"
NARRATIVE_CLOSE = "</narrative>"
OPTIONS_OPEN = "<options>"
OPTIONS_CLOSE = "</options>"
THINK_OPEN = "<think>"
THINK_CLOSE = "</think>"
NOTES_OPEN = "<director-notes>"
NOTES_CLOSE = "</director-notes>"
# 备注最多留这么多字：写给后台看的，世界状态 agent 会读，也会回到之后的上下文里
MAX_NOTES_CHARS = 600

_PATTERNS = {
    tag: re.compile(re.escape(tag), re.IGNORECASE)
    for tag in (
        NARRATIVE_OPEN,
        NARRATIVE_CLOSE,
        OPTIONS_OPEN,
        OPTIONS_CLOSE,
        THINK_OPEN,
        THINK_CLOSE,
        NOTES_OPEN,
        NOTES_CLOSE,
    )
}
# 只认 1、2 号：多于 2 个只取前 2 个。模型输出不可信（自定义端点可以返回任意内容），
# 正则必须是线性的：选项文字用 \S(?:.*\S)? 取首尾非空白之间的部分，不用 (.+?)\s*$
NUMBERED_OPTION = re.compile(r"^\s*+[12１２]\s*+[.．、)）:：]\s*+(\S(?:.*\S)?)\s*$")
_ANY_LIST_MARK = re.compile(r"^\s*+(?:[-*•·]|\d++\s*+[.．、)）:：])\s*+")


# 结局那一轮本来就不该有选项，这条修补说明在结局里不算问题
MISSING_OPTIONS = "missing <options> tag"
# 提供了工具时，模型偶尔把工具调用写成正文（例如 <recall><query>…，
# 或者 DeepSeek 内部的 DSML 标记），而不是走工具调用。这种文字不能当叙述抢救出来
TOOL_CALL_AS_TEXT = "tool call written as text"
_TOOL_MARKUP = re.compile(
    r"DSML|<\s*+/?\s*+(?:recall|read_turn|lookup|tool_calls?|function_calls?|invoke)\b",
    re.IGNORECASE,
)


class ParseStage(StrEnum):
    OK = "ok"  # 完全合规
    SALVAGED = "salvaged"  # 标签有缺损，叙述和选项由解析器抢救出来
    REPAIRED = "repaired"  # 选项不足，由 OptionsRepair 补齐
    MISSING = "missing"  # 补选项两次都没补齐：选项不足 2 个，玩家自己写下一步
    FAILED = "failed"  # 没有叙述


class _State(Enum):
    SEEK_NARRATIVE = 1
    IN_NARRATIVE = 2
    SEEK_OPTIONS = 3
    IN_OPTIONS = 4
    IN_THINK = 5
    IN_NOTES = 6
    DONE = 7


@dataclass(frozen=True, slots=True)
class DirectorParse:
    narrative: str
    options: tuple[str, ...]  # 解析出的全部有效选项，可能多于或少于 2 个
    stage: ParseStage  # 仅反映解析阶段：OK、SALVAGED 或 FAILED
    repairs: tuple[str, ...]  # 影响合规判定的修补
    notes: tuple[str, ...]  # 仅供记录，例如标签外有多余文字
    rewritten: bool = False  # 最终叙述与流式输出的拼接不一致，客户端应以最终叙述为准
    director_notes: str = ""  # <director-notes> 里的备注，玩家看不到；没写时为空

    @property
    def needs_options_repair(self) -> bool:
        return len(self.options) < 2


def _earliest(buf: str, tags: Sequence[str]) -> tuple[str, int, int] | None:
    best: tuple[str, int, int] | None = None
    for tag in tags:
        match = _PATTERNS[tag].search(buf)
        if match is not None and (best is None or match.start() < best[1]):
            best = (tag, match.start(), match.end())
    return best


def _partial_suffix(buf: str, tags: Sequence[str]) -> int:
    """缓冲尾部最长的、可能是某个标签前缀的长度。"""
    longest = max(len(tag) for tag in tags) - 1
    for size in range(min(longest, len(buf)), 0, -1):
        tail = buf[-size:].lower()
        if any(size < len(tag) and tag.startswith(tail) for tag in tags):
            return size
    return 0


def extract_numbered_options(text: str) -> list[str]:
    return [m.group(1) for line in text.splitlines() if (m := NUMBERED_OPTION.match(line))]


class DirectorStreamParser:
    def __init__(self) -> None:
        self._state = _State.SEEK_NARRATIVE
        self._think_return = _State.SEEK_NARRATIVE
        self._notes_return = _State.DONE
        self._notes: list[str] = []
        self._notes_closed = True
        self._buf = ""
        self._preamble: list[str] = []
        self._between: list[str] = []
        self._options_raw: list[str] = []
        self._trailing: list[str] = []
        self._narrative: list[str] = []
        self._pending_ws = ""
        self._emitted_any = False
        self._narrative_opened = False
        self._narrative_closed = False
        self._options_opened = False
        self._options_closed = False
        self._repairs: list[str] = []
        self._finished = False

    @property
    def narrative_closed(self) -> bool:
        """叙述已经结束（闭合标签出现，或已经进入选项）：之后不会再有叙述片段。"""
        return self._narrative_closed or (self._narrative_opened and self._options_opened)

    def feed(self, chunk: str) -> list[str]:
        """喂入一段模型输出，返回可以立即推给玩家的叙述片段。"""
        if self._finished:
            raise RuntimeError("parser already finished")
        self._buf += chunk
        out: list[str] = []
        self._advance(out, final=False)
        return out

    def finish(self) -> tuple[list[str], DirectorParse]:
        """流结束：返回最后的叙述片段和解析结果。"""
        if self._finished:
            raise RuntimeError("parser already finished")
        out: list[str] = []
        self._advance(out, final=True)
        self._finished = True
        return out, self._result(out)

    # ---- 状态机 ---------------------------------------------------------------

    def _take(
        self, tags: Sequence[str], final: bool
    ) -> tuple[str, str, int] | tuple[str, None, int]:
        """返回 (标签前的文字, 命中的标签或 None, 标签后的位置)。"""
        buf = self._buf
        hit = _earliest(buf, tags)
        if hit is None:
            keep = 0 if final else _partial_suffix(buf, tags)
            return buf[: len(buf) - keep], None, len(buf) - keep
        tag, start, end = hit
        return buf[:start], tag, end

    def _advance(self, out: list[str], *, final: bool) -> None:
        while True:
            state = self._state
            if state is _State.DONE:
                text, tag, pos = self._take((NOTES_OPEN,), final)
                self._trailing.append(text)
                self._buf = self._buf[pos:]
                if tag is None:
                    return
                self._enter_notes(_State.DONE)
            elif state is _State.IN_NOTES:
                text, tag, pos = self._take((NOTES_CLOSE,), final)
                self._notes.append(text)
                self._buf = self._buf[pos:]
                if tag is None:
                    return
                self._notes_closed = True
                self._state = self._notes_return
            elif state is _State.SEEK_NARRATIVE:
                text, tag, pos = self._take(
                    (NARRATIVE_OPEN, THINK_OPEN, OPTIONS_OPEN, NOTES_OPEN), final
                )
                self._preamble.append(text)
                self._buf = self._buf[pos:]
                if tag is None:
                    return
                if tag == THINK_OPEN:
                    self._enter_think(_State.SEEK_NARRATIVE)
                elif tag == NOTES_OPEN:
                    self._enter_notes(_State.SEEK_NARRATIVE)
                elif tag == NARRATIVE_OPEN:
                    self._narrative_opened = True
                    self._state = _State.IN_NARRATIVE
                else:
                    self._options_opened = True
                    self._state = _State.IN_OPTIONS
            elif state is _State.IN_THINK:
                _, tag, pos = self._take((THINK_CLOSE,), final)
                self._buf = self._buf[pos:]
                if tag is None:
                    return
                self._state = self._think_return
            elif state is _State.IN_NARRATIVE:
                text, tag, pos = self._take((NARRATIVE_CLOSE, OPTIONS_OPEN, NOTES_OPEN), final)
                self._emit(text, out)
                self._buf = self._buf[pos:]
                if tag is None:
                    return
                self._pending_ws = ""
                if tag == NARRATIVE_CLOSE:
                    self._narrative_closed = True
                    self._state = _State.SEEK_OPTIONS
                elif tag == NOTES_OPEN:
                    # 备注不能混进叙述：叙述到这里为止
                    self._repairs.append("<director-notes> started before <narrative> was closed")
                    self._narrative_closed = True
                    self._enter_notes(_State.SEEK_OPTIONS)
                else:
                    self._repairs.append("<options> started before <narrative> was closed")
                    self._options_opened = True
                    self._state = _State.IN_OPTIONS
            elif state is _State.SEEK_OPTIONS:
                text, tag, pos = self._take((OPTIONS_OPEN, THINK_OPEN, NOTES_OPEN), final)
                self._between.append(text)
                self._buf = self._buf[pos:]
                if tag is None:
                    return
                if tag == THINK_OPEN:
                    self._enter_think(_State.SEEK_OPTIONS)
                elif tag == NOTES_OPEN:
                    self._enter_notes(_State.SEEK_OPTIONS)
                else:
                    self._options_opened = True
                    self._state = _State.IN_OPTIONS
            elif state is _State.IN_OPTIONS:
                text, tag, pos = self._take((OPTIONS_CLOSE, NOTES_OPEN), final)
                self._options_raw.append(text)
                self._buf = self._buf[pos:]
                if tag is None:
                    return
                if tag == NOTES_OPEN:
                    self._enter_notes(_State.DONE)  # 选项没闭合就开始写备注
                else:
                    self._options_closed = True
                    self._state = _State.DONE

    def _enter_think(self, return_to: _State) -> None:
        self._think_return = return_to
        self._state = _State.IN_THINK

    def _enter_notes(self, return_to: _State) -> None:
        if self._notes:
            self._notes.append("\n")
        self._notes_return = return_to
        self._notes_closed = False
        self._state = _State.IN_NOTES

    def _emit(self, text: str, out: list[str]) -> None:
        if not text:
            return
        if not self._emitted_any:
            text = text.lstrip()
            if not text:
                return
        combined = self._pending_ws + text
        body = combined.rstrip()
        self._pending_ws = combined[len(body) :]
        if body:
            out.append(body)
            self._narrative.append(body)
            self._emitted_any = True

    # ---- 结果 -----------------------------------------------------------------

    def _result(self, out: list[str]) -> DirectorParse:
        repairs = list(self._repairs)
        notes: list[str] = []
        narrative = "".join(self._narrative)
        rewritten = False
        numbered_ok = False
        options: list[str] = []

        if self._options_opened:
            raw = "".join(self._options_raw)
            numbered = extract_numbered_options(raw)
            if len(normalize_options(numbered)) >= 2:
                options = numbered
                numbered_ok = True
            else:
                lines = [_ANY_LIST_MARK.sub("", line) for line in raw.splitlines()]
                options = [line for line in lines if line.strip()]
                repairs.append("choices in <options> were not numbered 1. 2.")
            if not self._options_closed:
                repairs.append("<options> was not closed")
        if not self._narrative_opened:
            # 没有 <narrative> 标签：前面的文字一个字都没推给玩家，这里整段抢救出来；
            # 写成文字的工具调用不抢救，这一段没有叙述
            text = "".join(self._preamble)
            if not self._options_opened:
                text, options = self._split_trailing_options(text)
            repairs.append("missing <narrative> tag")
            if _TOOL_MARKUP.search(text):
                repairs.append(TOOL_CALL_AS_TEXT)
                text, options = "", []
            salvaged = text.strip()
            if salvaged:
                out.append(salvaged)
            narrative = salvaged
        elif not self._narrative_closed and not self._options_opened:
            repairs.append("<narrative> was not closed before the stream ended")
            body, trailing = self._split_trailing_options(narrative)
            if len(normalize_options(trailing)) >= 2:
                narrative = body.strip()
                options = trailing
                rewritten = True
                repairs.append("choices were mixed into the narrative")
        elif self._narrative_closed and not self._options_opened:
            options = extract_numbered_options("".join(self._between))
            repairs.append(MISSING_OPTIONS)
        else:
            if "".join(self._preamble).strip():
                notes.append("extra text before <narrative>")
            if "".join(self._between).strip():
                notes.append("extra text between </narrative> and <options>")
            if "".join(self._trailing).strip():
                notes.append("extra text after </options>")

        if not self._notes_closed:
            notes.append("<director-notes> was not closed")
        cleaned = normalize_options(options)
        if len(cleaned) > 2:
            notes.append(f"{len(cleaned)} choices given, kept the first 2")
        if not narrative.strip():
            stage = ParseStage.FAILED
        elif (
            not repairs
            and numbered_ok
            and self._narrative_closed
            and self._options_closed
            and len(cleaned) >= 2
        ):
            stage = ParseStage.OK
        else:
            stage = ParseStage.SALVAGED
        return DirectorParse(
            narrative=narrative,
            options=tuple(cleaned),
            stage=stage,
            repairs=tuple(repairs),
            notes=tuple(notes),
            rewritten=rewritten,
            director_notes="".join(self._notes).strip()[:MAX_NOTES_CHARS],
        )

    @staticmethod
    def _split_trailing_options(text: str) -> tuple[str, list[str]]:
        """从文本末尾找连续的 1. 2. 编号行，拆成 (正文, 选项)。"""
        lines = text.splitlines()
        index = len(lines)
        found: list[str] = []
        while index > 0:
            line = lines[index - 1]
            if not line.strip():
                index -= 1
                continue
            match = NUMBERED_OPTION.match(line)
            if match is None:
                break
            found.insert(0, match.group(1))
            index -= 1
        if not found:
            return text, []
        return "\n".join(lines[:index]), found


def parse_director_text(text: str) -> DirectorParse:
    """非流式地解析一整段导演输出（评测和测试用）。"""
    parser = DirectorStreamParser()
    parser.feed(text)
    _, result = parser.finish()
    return result
