"""一局怎么玩（playthroughs.mode，docs/agent-runtime.md 的“闪电模式”）。

- standard：导演写叙述，后台整理世界状态、写章节摘要和大纲；
- lightning：只有导演，每回合一次请求；不整理世界状态、不写大纲，
  原文超过阈值时在后台用导演的模型压成一版梗概。省钱，代价是长故事前后可能对不上。

开局时从剧本的设置拷过来，之后不变：中途从闪电换回普通，世界状态是空的，接不上。
"""

from __future__ import annotations

from typing import Literal

PlayMode = Literal["standard", "lightning"]
PLAY_MODES: tuple[PlayMode, ...] = ("standard", "lightning")


def parse_mode(value: object) -> PlayMode:
    """读库里的值：不认识的当作 standard。"""
    return "lightning" if value == "lightning" else "standard"


def is_lightning(mode: str) -> bool:
    return mode == "lightning"
