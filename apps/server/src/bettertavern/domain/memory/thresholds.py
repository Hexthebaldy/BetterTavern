"""有效窗口与占用率阈值。

有效窗口 W = min(模型窗口 M, 工作窗口上限 C) − 预留输出 − 2% 余量（余量按 min(M, C) 计）。
W 小于 16K 的路由不支持。占用率 = 下一轮上下文的 token 数 ÷ W：
- 超过 80%：调用 Compactor 压缩（只做数值比较，不调用任何模型）；
- 发给模型之前的实际装配结果超过 95%：只截断发送视图，到不超过 90% 为止，数据不删；
- 厂商报超窗（说明估算偏低）：截断到不超过 85% 后重试一次。

保存路由和装配上下文共用这里的纯函数，避免两处算法不一致。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum

MIN_EFFECTIVE_WINDOW = 16_000
DEFAULT_WORKING_WINDOW = 128_000
SAFETY_MARGIN = 0.02
COMPACT_LINE = 0.80
EMERGENCY_LINE = 0.95
EMERGENCY_TARGET = 0.90
OVERFLOW_RETRY_TARGET = 0.85

WINDOW_CLAMPED = "WINDOW_CLAMPED"


@dataclass(frozen=True, slots=True)
class WindowCheck:
    model_window: int
    working_cap: int
    reserved_output: int
    effective_window: int

    @property
    def clamped(self) -> bool:
        """玩家设的上限超过了模型窗口：照常保存，但实际按模型窗口算。"""
        return self.working_cap > self.model_window

    @property
    def too_small(self) -> bool:
        return self.effective_window < MIN_EFFECTIVE_WINDOW

    @property
    def warnings(self) -> tuple[str, ...]:
        return (WINDOW_CLAMPED,) if self.clamped else ()


def effective_window(
    model_window: int,
    working_cap: int | None,
    reserved_output: int,
    *,
    margin: float = SAFETY_MARGIN,
) -> WindowCheck:
    if model_window <= 0:
        raise ValueError("model window must be positive")
    if reserved_output < 0:
        raise ValueError("reserved output can't be negative")
    cap = DEFAULT_WORKING_WINDOW if working_cap is None else working_cap
    if cap <= 0:
        raise ValueError("working window cap must be positive")
    base = min(model_window, cap)
    window = math.floor(base - reserved_output - base * margin)
    return WindowCheck(
        model_window=model_window,
        working_cap=cap,
        reserved_output=reserved_output,
        effective_window=max(window, 0),
    )


class Occupancy(StrEnum):
    OK = "ok"
    COMPACT = "compact"  # 超过 80%：入队压缩
    EMERGENCY = "emergency"  # 超过 95%：先紧急截断发送视图


def occupancy_ratio(tokens: int, window: int) -> float:
    if window <= 0:
        raise ValueError("effective window must be positive")
    return tokens / window


def classify_occupancy(tokens: int, window: int) -> Occupancy:
    ratio = occupancy_ratio(tokens, window)
    if ratio > EMERGENCY_LINE:
        return Occupancy.EMERGENCY
    if ratio > COMPACT_LINE:
        return Occupancy.COMPACT
    return Occupancy.OK


def emergency_budget(window: int) -> int:
    """紧急截断的目标 token 数（W 的 90%）。"""
    return math.floor(window * EMERGENCY_TARGET)


def overflow_retry_budget(window: int) -> int:
    """厂商报超窗后重试时的目标 token 数（W 的 85%）。"""
    return math.floor(window * OVERFLOW_RETRY_TARGET)
