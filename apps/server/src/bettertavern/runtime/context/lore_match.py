"""世界书关键词怎么算命中（docs/lorebook.md 第 7.2 节），是 lore.py 的同级文件。规则照 SillyTavern
（public/scripts/world-info.js 的 WorldInfoBuffer.matchKeys）：

- 普通关键词：不区分大小写（条目可以改），整词匹配（默认开：一个词的关键词前后不能紧挨英文字母、
  数字、下划线；关键词里有空格时按包含找；中文前后都不是这几种字符，实际就是按包含找）；
  比 ST 多做一步全角转半角；
- /……/flags 写的是正则，按原文匹配：用 regex 库，每个最多 REGEX_TIMEOUT_S 秒，一回合加起来最多
  REGEX_TURN_BUDGET_S 秒，超时的当没命中、记下次数（用户写坏的正则不能卡住进程）；
- 组打分：命中了几个关键词（ST 的 getScore）。
"""

from __future__ import annotations

import re
import time
import unicodedata
from collections.abc import Callable
from functools import lru_cache

import regex

from bettertavern.domain.scenario.card import LoreEntry, LoreRules
from bettertavern.domain.scenario.lorebook import RegexKey, regex_key

REGEX_TIMEOUT_S = 0.02
REGEX_TURN_BUDGET_S = 0.2
_WORD = r"[A-Za-z0-9_]"  # JS 不带 u 时 \w 的范围


def _fold(text: str, *, case_sensitive: bool) -> str:
    text = unicodedata.normalize("NFKC", text)
    return text if case_sensitive else text.casefold()


@lru_cache(maxsize=4096)
def _word_pattern(key: str) -> re.Pattern[str]:
    # 关键词是转义过的字面量，不会回溯爆炸
    return re.compile(rf"(?<!{_WORD}){re.escape(key)}(?!{_WORD})")


@lru_cache(maxsize=4096)
def _compiled(pattern: str, flags: int) -> regex.Pattern[str] | None:
    try:
        return regex.compile(pattern, flags)
    except (regex.error, ValueError, OverflowError, RecursionError):
        return None


class Matcher:
    """一回合用一个：缓存折叠过的文字，记正则用了多久、超时几次。"""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._folded: dict[tuple[str, bool], str] = {}
        self.regex_spent = 0.0
        self.regex_timeouts = 0

    def _haystack(self, text: str, case_sensitive: bool) -> str:
        key = (text, case_sensitive)
        if key not in self._folded:
            self._folded[key] = _fold(text, case_sensitive=case_sensitive)
        return self._folded[key]

    def matches(self, key: str, text: str, rules: LoreRules) -> bool:
        if not text:
            return False
        parsed = regex_key(key)
        if parsed is not None:
            return self._regex(parsed, text)
        case_sensitive = bool(rules.case_sensitive)
        needle = _fold(key, case_sensitive=case_sensitive)
        haystack = self._haystack(text, case_sensitive)
        whole_words = rules.whole_words if rules.whole_words is not None else True
        if not whole_words or len(needle.split()) > 1:
            return needle in haystack
        return needle in haystack and _word_pattern(needle).search(haystack) is not None

    def _regex(self, parsed: RegexKey, text: str) -> bool:
        if self.regex_spent >= REGEX_TURN_BUDGET_S:
            self.regex_timeouts += 1
            return False
        flags = (
            (regex.IGNORECASE if parsed.ignore_case else 0)
            | (regex.DOTALL if parsed.dotall else 0)
            | (regex.MULTILINE if parsed.multiline else 0)
        )
        compiled = _compiled(parsed.pattern, flags)
        if compiled is None:
            return False
        started = self._clock()
        try:
            return compiled.search(text, timeout=REGEX_TIMEOUT_S, concurrent=True) is not None
        except TimeoutError:
            self.regex_timeouts += 1
            return False
        finally:
            self.regex_spent += self._clock() - started

    def secondary_ok(self, entry: LoreEntry, text: str, rules: LoreRules) -> bool:
        if not entry.secondary_keys:
            return True
        hits = [self.matches(k, text, rules) for k in entry.secondary_keys]
        if entry.logic == "any":
            return any(hits)
        if entry.logic == "all":
            return all(hits)
        if entry.logic == "not_any":
            return not any(hits)
        return not all(hits)  # not_all

    def score(self, entry: LoreEntry, text: str, rules: LoreRules) -> int:
        """组打分：命中的主关键词数，加上次要关键词（逻辑是 any 时都加，是 all 时全中才加）。"""
        if not entry.keys:
            return 0
        primary = sum(1 for k in entry.keys if self.matches(k, text, rules))
        if not entry.secondary_keys or entry.logic not in ("any", "all"):
            return primary
        secondary = sum(1 for k in entry.secondary_keys if self.matches(k, text, rules))
        if entry.logic == "all" and secondary < len(entry.secondary_keys):
            return primary
        return primary + secondary
