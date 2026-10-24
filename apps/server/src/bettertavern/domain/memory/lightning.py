"""闪电模式的上下文管理（docs/agent-runtime.md 的“闪电模式”）：只按长度压缩，不看场景。

闪电模式没有世界状态 agent，也就没有“场景结束”和回合标签。上下文里是：规则和设定、一版梗概、
梗概之后的原文。原文累计超过阈值时，后台用导演的模型把较早的一大段和旧梗概合成新的一版梗概，
最近一段原文留着接上文。

- 阈值：min(LIGHTNING_COMPRESS_TOKENS, 导演有效窗口的一半)；
- 压掉哪些：从最新往回留，留下的原文至少 LIGHTNING_KEEP_TOKENS、至少 LIGHTNING_KEEP_TURNS 回合，
  其余的压进梗概；
- 原文从梗概覆盖到的回合之后开始，不像章节那样多留上一章最后两回合：最近的原文本来就留着，
  重复放进来只是多花钱。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

LIGHTNING_COMPRESS_TOKENS = 12_000
LIGHTNING_KEEP_TOKENS = 3_000
LIGHTNING_KEEP_TURNS = 2


@dataclass(frozen=True, slots=True)
class RawTurn:
    seq: int
    tokens: int  # 这一回合原文（玩家行动、叙述、选项）的 token 数


def compress_threshold(effective_window: int, cap: int = LIGHTNING_COMPRESS_TOKENS) -> int:
    """原文累计到多少 token 时压缩：不超过 cap，也不超过导演有效窗口的一半。"""
    return max(1, min(cap, effective_window // 2))


def compress_end(
    turns: Sequence[RawTurn],
    threshold: int,
    *,
    keep_tokens: int = LIGHTNING_KEEP_TOKENS,
    keep_turns: int = LIGHTNING_KEEP_TURNS,
) -> int | None:
    """turns 是梗概之后的原文回合（按回合升序）。还不到阈值、或者留够最近的原文以后没有可压的，
    返回 None；否则返回压到第几回合（含）。"""
    if sum(t.tokens for t in turns) < threshold:
        return None
    kept_tokens = 0
    for kept, turn in enumerate(reversed(turns)):
        if kept >= keep_turns and kept_tokens >= keep_tokens:
            return turn.seq
        kept_tokens += turn.tokens
    return None


def raw_start(summarized_seq: int) -> int:
    """闪电模式下导演上下文里的原文从第几回合开始：梗概覆盖到的回合之后。"""
    return max(0, summarized_seq + 1)
