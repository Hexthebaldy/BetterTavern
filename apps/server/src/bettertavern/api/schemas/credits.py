"""点数（官方模型的用量）。"""

from __future__ import annotations

from .common import Out


class CreditsOut(Out):
    # 余额，单位是点（1 点 = 0.001 元的模型费用）；后台整理可能让它短暂变成负数
    balance: int
    # 估计每回合花多少点（含后台整理）：按自己最近一周的记录，记录太少时用默认值
    turn_points: int
    # 估计还能写多少回合
    turns_left: int
    # 这台服务器有没有官方模型
    platform: bool
    # 导演是不是官方模型（不是的话，用的是自己的 Key，不扣点数）
    uses_platform: bool
