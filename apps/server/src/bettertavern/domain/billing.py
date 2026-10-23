"""官方模型的计费：服务器用运营方自己的 Key 调模型时，按服务商报告的用量扣用户的点数。

单位：
- 钱按“微元”（百万分之一元）记，整数，不会有小数误差；
- 给用户看的是“点”：1 点 = 0.001 元 = 1000 微元。新用户送的 1500 点就是 1.5 元的模型费用。

用户自己的 Key 不计费（路由上没有单价）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

MICRO_PER_POINT = 1000


@dataclass(frozen=True, slots=True)
class TokenPrices:
    """每百万 token 多少元：输入里没命中缓存的、命中缓存的、输出（含思考）。"""

    input: float
    cached: float
    output: float

    def cost_micro(self, *, prompt: int, cached: int, completion: int) -> int:
        """一次调用花了多少微元。prompt 是全部输入（含命中缓存的部分），向上取整，宁多不少。"""
        cached = max(min(cached, prompt), 0)
        # 每百万 token X 元 = 每个 token X 微元
        cost = (prompt - cached) * self.input + cached * self.cached + completion * self.output
        return math.ceil(cost)


def points(micro: int) -> int:
    """余额显示成多少点（不足 1 点的部分不显示；欠费时是负数）。"""
    return math.floor(micro / MICRO_PER_POINT)


def micro_of_points(value: int) -> int:
    return value * MICRO_PER_POINT
