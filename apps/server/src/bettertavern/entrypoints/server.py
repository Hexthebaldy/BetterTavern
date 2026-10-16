"""带优雅退出的 uvicorn 服务器：收到 SIGTERM / SIGINT 的第一时间通知应用。"""

from __future__ import annotations

from types import FrameType
from typing import Any

import uvicorn

from bettertavern.api.lifecycle import Shutdown
from bettertavern.settings import Settings


def proxy_options(settings: Settings) -> dict[str, Any]:
    """经反向代理访问时怎么认出请求的真实 IP（注册、登录的限流按它计数）。

    只有来自 FORWARDED_ALLOW_IPS 里地址的连接，才采信它带来的 X-Forwarded-For；
    别的连接自己写的 X-Forwarded-For 一律不认，伪造不了。
    """
    return {"proxy_headers": True, "forwarded_allow_ips": settings.forwarded_allow_ips}


class GracefulServer(uvicorn.Server):
    def __init__(self, config: uvicorn.Config, shutdown: Shutdown) -> None:
        super().__init__(config)
        self._shutdown = shutdown

    def handle_exit(self, sig: int, frame: FrameType | None) -> None:
        self._shutdown.trigger()
        super().handle_exit(sig, frame)
