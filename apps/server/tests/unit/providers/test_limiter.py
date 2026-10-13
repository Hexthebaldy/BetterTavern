from __future__ import annotations

import asyncio

import pytest

from bettertavern.providers.limiter import (
    CredentialLimiter,
    LimiterConfig,
    LimiterTimeout,
)

pytestmark = pytest.mark.anyio


async def test_background_cannot_take_reserved_slot() -> None:
    limiter = CredentialLimiter(LimiterConfig(capacity=2, reserved_interactive=1))
    async with limiter.slot("c", interactive=False):
        # 后台任务已占满它能用的 1 个槽位
        with pytest.raises(LimiterTimeout):
            async with limiter.slot("c", interactive=False, timeout=0.05):
                pass
        # 但交互请求仍然能进
        async with limiter.slot("c", interactive=True, timeout=0.05):
            assert limiter.in_use("c") == 2


async def test_waiter_gets_slot_after_release() -> None:
    limiter = CredentialLimiter(LimiterConfig(capacity=1, reserved_interactive=0))
    order: list[str] = []

    async def holder() -> None:
        async with limiter.slot("c", interactive=True):
            order.append("holder-in")
            await asyncio.sleep(0.05)
            order.append("holder-out")

    async def waiter() -> None:
        await asyncio.sleep(0.01)
        async with limiter.slot("c", interactive=True, timeout=1.0):
            order.append("waiter-in")

    await asyncio.gather(holder(), waiter())
    assert order == ["holder-in", "holder-out", "waiter-in"]
    assert limiter.in_use("c") == 0


async def test_credentials_are_independent() -> None:
    limiter = CredentialLimiter(LimiterConfig(capacity=1, reserved_interactive=0))
    async with (
        limiter.slot("a", interactive=True),
        limiter.slot("b", interactive=True, timeout=0.05),
    ):
        assert limiter.in_use("a") == limiter.in_use("b") == 1


async def test_cooldown_after_rate_limit() -> None:
    now = [100.0]
    limiter = CredentialLimiter(clock=lambda: now[0])
    limiter.note_rate_limited("c", retry_after=30.0)
    with pytest.raises(LimiterTimeout, match="冷却"):
        async with limiter.slot("c", interactive=False, timeout=5.0):
            pass
    now[0] = 131.0
    async with limiter.slot("c", interactive=False, timeout=5.0):
        pass


def test_config_validation() -> None:
    with pytest.raises(ValueError):
        LimiterConfig(capacity=0)
    with pytest.raises(ValueError):
        LimiterConfig(capacity=2, reserved_interactive=2)
