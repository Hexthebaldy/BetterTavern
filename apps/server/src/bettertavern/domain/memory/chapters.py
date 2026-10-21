"""章节在哪里切（docs/agent-runtime.md 第 4 节“章节整理”）：固定规则，不让模型判断。

从上次章节摘要之后的回合开始累计原文的 token 数：
- 超过 soft 以后，在下一个“场景结束”处切一章（场景结束由世界状态 agent 判断），章节断在自然的地方；
- 一直没有场景结束，累计到 hard 时硬切。
只看已经整理进世界状态的回合：它们的“场景是否结束”才知道，章节整理也要用它们的一句话摘要。
阈值以后按剧本试玩的结果调（设置项 CHAPTER_SOFT_TOKENS、CHAPTER_HARD_TOKENS）。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

CHAPTER_SOFT_TOKENS = 8000
CHAPTER_HARD_TOKENS = 16000
# 最近几章保留各自的章节摘要；更早的并进全书梗概
KEPT_CHAPTERS = 3
# 上一章最后几回合的原文留在上下文里，新一章的开头接得上
CHAPTER_OVERLAP_TURNS = 2


@dataclass(frozen=True, slots=True)
class ChapterRule:
    soft_tokens: int = CHAPTER_SOFT_TOKENS
    hard_tokens: int = CHAPTER_HARD_TOKENS

    def __post_init__(self) -> None:
        if not 0 < self.soft_tokens <= self.hard_tokens:
            raise ValueError("chapter thresholds need 0 < soft <= hard")


@dataclass(frozen=True, slots=True)
class TurnSize:
    seq: int
    tokens: int  # 这一回合原文（玩家行动、叙述、选项）的 token 数
    scene_ended: bool


def chapter_end(turns: Sequence[TurnSize], rule: ChapterRule) -> int | None:
    """turns 是上次章节摘要之后、已经整理进世界状态的回合（按回合升序）。
    返回这一章到第几回合结束；还不到切的时候返回 None。"""
    total = 0
    for turn in turns:
        total += turn.tokens
        if total >= rule.hard_tokens:
            return turn.seq
        if total >= rule.soft_tokens and turn.scene_ended:
            return turn.seq
    return None


def raw_start(summarized_seq: int) -> int:
    """导演上下文里的原文从第几回合开始：章节摘要覆盖到的回合之后，再往前多留上一章最后几回合。"""
    if summarized_seq < 0:
        return 0
    return max(0, summarized_seq + 1 - CHAPTER_OVERLAP_TURNS)
