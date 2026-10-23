"""官方模型的计费：用量换成微元、余额显示成点。"""

from __future__ import annotations

from bettertavern.domain.billing import TokenPrices, micro_of_points, points

# DeepSeek 白天的价格：元 / 百万 token
PRICES = TokenPrices(input=2.0, cached=0.04, output=8.0)


def test_cost_counts_cached_input_at_the_cache_price() -> None:
    # 1000 个输入里 800 个命中缓存：200 × 2 + 800 × 0.04 + 100 × 8
    assert PRICES.cost_micro(prompt=1000, cached=800, completion=100) == 400 + 32 + 800


def test_cost_rounds_up_and_never_bills_more_cache_than_input() -> None:
    assert PRICES.cost_micro(prompt=1, cached=1, completion=0) == 1  # 0.04 微元也算 1
    assert PRICES.cost_micro(prompt=10, cached=50, completion=0) == 1  # 缓存最多算到全部输入
    assert PRICES.cost_micro(prompt=10, cached=-3, completion=0) == 20
    assert PRICES.cost_micro(prompt=0, cached=0, completion=0) == 0


def test_a_typical_turn_costs_a_few_dozen_points() -> None:
    # 导演一回合：约 2 万输入（多半命中缓存）、800 输出
    cost = PRICES.cost_micro(prompt=20_000, cached=16_000, completion=800)
    assert 10 <= points(cost) <= 20


def test_points_round_down_and_go_negative_when_overdrawn() -> None:
    assert points(micro_of_points(1500)) == 1500
    assert points(1999) == 1
    assert points(999) == 0
    assert points(-1) == -1
