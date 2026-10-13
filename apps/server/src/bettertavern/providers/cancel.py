"""取消令牌：玩家点取消、发起回退、进程关闭时触发，provider 层据此关闭上游连接。"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from .errors import ErrorClass, ProviderError


class CancelToken:
    __slots__ = ("_callbacks", "_event", "_reason")

    def __init__(self) -> None:
        self._event = asyncio.Event()
        self._reason: str | None = None
        self._callbacks: list[Callable[[str], None]] = []

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    @property
    def reason(self) -> str | None:
        return self._reason

    def cancel(self, reason: str = "cancelled") -> None:
        if self._event.is_set():
            return
        self._reason = reason
        self._event.set()
        callbacks, self._callbacks = self._callbacks, []
        for callback in callbacks:
            callback(reason)

    def add_callback(self, callback: Callable[[str], None]) -> Callable[[], None]:
        """注册取消回调；已取消时立即调用。返回一个注销函数。"""
        if self.cancelled:
            callback(self._reason or "cancelled")
            return lambda: None
        self._callbacks.append(callback)

        def remove() -> None:
            if callback in self._callbacks:
                self._callbacks.remove(callback)

        return remove

    async def wait(self) -> str:
        await self._event.wait()
        return self._reason or "cancelled"

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise cancelled_error(self)


def cancelled_error(token: CancelToken) -> ProviderError:
    return ProviderError(ErrorClass.CANCELLED, f"请求已取消：{token.reason or 'cancelled'}")


async def await_or_cancel[T](awaitable: Awaitable[T], token: CancelToken | None) -> T:
    """等待 awaitable；令牌先触发就取消它并抛 CANCELLED。"""
    if token is None:
        return await awaitable
    task = asyncio.ensure_future(awaitable)
    if token.cancelled:
        task.cancel()
        await asyncio.wait({task})
        raise cancelled_error(token)
    waiter = asyncio.ensure_future(token.wait())
    try:
        done, _ = await asyncio.wait({task, waiter}, return_when=asyncio.FIRST_COMPLETED)
    except BaseException:
        task.cancel()
        waiter.cancel()
        raise
    if task in done:
        waiter.cancel()
        return task.result()
    task.cancel()
    await asyncio.wait({task})
    if not task.cancelled():
        task.exception()  # 标记为已读取，避免“异常未被取回”的警告
    raise cancelled_error(token)
