"""带优雅退出的 uvicorn 服务器：收到 SIGTERM / SIGINT 的第一时间通知应用。"""

from __future__ import annotations

from types import FrameType

import uvicorn

from bettertavern.api.lifecycle import Shutdown


class GracefulServer(uvicorn.Server):
    def __init__(self, config: uvicorn.Config, shutdown: Shutdown) -> None:
        super().__init__(config)
        self._shutdown = shutdown

    def handle_exit(self, sig: int, frame: FrameType | None) -> None:
        self._shutdown.trigger()
        super().handle_exit(sig, frame)
