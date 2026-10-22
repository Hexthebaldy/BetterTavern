"""经 Resend 发信：POST https://api.resend.com/emails（https://resend.com/docs/api-reference/emails/send-email）。

发件人的域名要先在 Resend 里验证过。超时、5xx 和 429 当作暂时失败（MailError，调用方提示稍后重试）。
"""

from __future__ import annotations

import contextlib

import httpx
import structlog

from . import Mail, MailError

log = structlog.get_logger(__name__)

ENDPOINT = "https://api.resend.com/emails"


class ResendSender:
    def __init__(
        self,
        api_key: str,
        sender: str,
        *,
        timeout_s: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._sender = sender
        self._client = httpx.AsyncClient(
            timeout=timeout_s,
            transport=transport,
            headers={"Authorization": f"Bearer {api_key}", "User-Agent": "BetterTavern"},
        )

    async def send(self, mail: Mail) -> None:
        body: dict[str, object] = {
            "from": self._sender,
            "to": [mail.to],
            "subject": mail.subject,
            "text": mail.text,
        }
        if mail.html:
            body["html"] = mail.html
        try:
            response = await self._client.post(ENDPOINT, json=body)
        except httpx.HTTPError as exc:
            log.warning("mail.send_failed", reason=type(exc).__name__)
            raise MailError(type(exc).__name__) from exc
        if response.status_code >= 300:
            # 响应里只有错误名和说明，没有收件人；只记状态码和错误名
            name = ""
            with contextlib.suppress(ValueError, AttributeError):
                name = str(response.json().get("name", ""))[:60]
            log.warning("mail.send_failed", status=response.status_code, error=name)
            raise MailError(f"HTTP {response.status_code} {name}".strip())
        log.info("mail.sent")

    async def aclose(self) -> None:
        await self._client.aclose()
