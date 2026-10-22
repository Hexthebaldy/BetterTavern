"""发邮件：验证码、找回密码、报错通知。

- ResendSender：经 Resend 的 HTTP 接口发（生产环境）；
- MemorySender：只记在内存里（测试）；
- LogSender：不发，只在日志里写一行（本机开发：验证码在日志里看）。

邮件正文按语言取 templates/<lang>.json（render.py）。日志里不记收件人和正文。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Mail:
    to: str
    subject: str
    text: str
    html: str = ""
    # 开发时给 LogSender 打到日志里的验证码；真的发信时不用
    dev_code: str | None = field(default=None, repr=False)


class MailError(Exception):
    """没发出去（服务商拒绝、超时、网络问题）。"""


class MailSender(Protocol):
    async def send(self, mail: Mail) -> None: ...

    async def aclose(self) -> None: ...
