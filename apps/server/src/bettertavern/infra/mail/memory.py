"""不真的发信的两种：测试用的 MemorySender，本机开发用的 LogSender。"""

from __future__ import annotations

import structlog

from . import Mail, MailError

log = structlog.get_logger(__name__)


class MemorySender:
    """记下发出的每一封；fail=True 时模拟服务商出错。"""

    def __init__(self) -> None:
        self.sent: list[Mail] = []
        self.fail = False

    async def send(self, mail: Mail) -> None:
        if self.fail:
            raise MailError("simulated failure")
        self.sent.append(mail)

    def last_to(self, address: str) -> Mail | None:
        for mail in reversed(self.sent):
            if mail.to == address:
                return mail
        return None

    async def aclose(self) -> None:
        return None


class LogSender:
    """本机开发：不发信，验证码写进日志（只在非生产环境用，见 entrypoints/bootstrap.py）。"""

    async def send(self, mail: Mail) -> None:
        log.info("mail.dev_outbox", subject=mail.subject, code=mail.dev_code)

    async def aclose(self) -> None:
        return None
