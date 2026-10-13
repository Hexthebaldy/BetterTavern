from __future__ import annotations

import pytest

from bettertavern.domain.memory.thresholds import (
    DEFAULT_WORKING_WINDOW,
    WINDOW_CLAMPED,
    Occupancy,
    classify_occupancy,
    effective_window,
    emergency_budget,
    overflow_retry_budget,
)


def test_default_cap_applies_to_million_token_models() -> None:
    check = effective_window(1_000_000, None, 4096)
    assert check.working_cap == DEFAULT_WORKING_WINDOW
    # 128000 − 4096 − 2% × 128000 = 121344
    assert check.effective_window == 121_344
    assert not check.clamped and not check.too_small
    assert check.warnings == ()


def test_cap_above_model_window_is_clamped_with_warning() -> None:
    check = effective_window(32_768, 128_000, 4096)
    assert check.clamped
    assert check.warnings == (WINDOW_CLAMPED,)
    # 32768 − 4096 − 2% × 32768 = 28016.64，向下取整
    assert check.effective_window == 28_016
    assert not check.too_small


def test_too_small_window() -> None:
    check = effective_window(32_768, 16_000, 4096)
    assert check.effective_window < 16_000
    assert check.too_small


def test_reserved_output_bigger_than_window_floors_at_zero() -> None:
    check = effective_window(8_000, None, 16_000)
    assert check.effective_window == 0
    assert check.too_small


@pytest.mark.parametrize(
    ("model", "cap", "reserved"), [(0, None, 1), (1000, 0, 1), (1000, None, -1)]
)
def test_invalid_inputs(model: int, cap: int | None, reserved: int) -> None:
    with pytest.raises(ValueError):
        effective_window(model, cap, reserved)


@pytest.mark.parametrize(
    ("tokens", "expected"),
    [
        (80_000, Occupancy.OK),
        (80_001, Occupancy.COMPACT),
        (95_000, Occupancy.COMPACT),
        (95_001, Occupancy.EMERGENCY),
    ],
)
def test_occupancy_lines(tokens: int, expected: Occupancy) -> None:
    assert classify_occupancy(tokens, 100_000) is expected


def test_truncation_targets() -> None:
    assert emergency_budget(100_000) == 90_000
    assert overflow_retry_budget(100_000) == 85_000
