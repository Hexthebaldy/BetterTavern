"""优雅退出的信号。

uvicorn 收到 SIGTERM 后先停止接收新连接、等已有连接结束，最后才跑 lifespan 的关闭逻辑；
而 SSE 连接不会自己结束，lifespan 关闭时已经太晚。所以由入口在收到信号的第一时间调用
Shutdown.trigger()：/ready 立即转为不就绪，SSE 订阅主动结束（客户端会带 Last-Event-ID 重连），
已有连接很快就能排空。
"""

from __future__ import annotations

import asyncio


class Shutdown:
    def __init__(self) -> None:
        self.event = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        """在事件循环里调用一次（lifespan 启动时），之后 trigger() 可以在信号处理函数里用。"""
        self._loop = loop

    def trigger(self) -> None:
        loop = self._loop
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(self.event.set)
        else:
            self.event.set()

    @property
    def triggered(self) -> bool:
        return self.event.is_set()
