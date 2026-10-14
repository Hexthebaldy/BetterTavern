"""在后台线程里用 uvicorn 跑任意 ASGI 应用，给需要真实 HTTP 连接的测试用。"""

from __future__ import annotations

import threading
import time
from typing import Any, Literal

import uvicorn


class AsgiServer:
    def __init__(self, app: Any, *, lifespan: Literal["auto", "on", "off"] = "off") -> None:
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=0,
            log_level="critical",
            lifespan=lifespan,
            loop="asyncio",
            http="h11",
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, daemon=True)
        self.port = 0

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> AsgiServer:
        self._thread.start()
        deadline = time.monotonic() + 10
        while not self._server.started:
            if time.monotonic() > deadline or not self._thread.is_alive():
                raise RuntimeError("测试服务没能在 10 秒内启动")
            time.sleep(0.01)
        self.port = self._server.servers[0].sockets[0].getsockname()[1]
        return self

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=10)
