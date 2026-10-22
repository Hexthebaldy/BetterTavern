"""报错提醒：把 ERROR 以上的日志按事件名计数，每隔一段时间（默认 15 分钟）合成一封邮件发出去。

邮件里只有事件名、来源模块、异常类型和次数，不带日志里的其他字段（可能有故事文本、请求内容）。
第三方库的日志（uvicorn、asyncpg）没有固定的事件名，只记模块名和异常类型。
发信失败只记一条 warning，不会反过来触发新的提醒。
"""

from __future__ import annotations

import asyncio
import logging
import socket
import threading
from collections import Counter
from datetime import datetime

import structlog

from bettertavern.infra.mail import Mail, MailError, MailSender

log = structlog.get_logger(__name__)

# 一封邮件里最多列多少种报错
MAX_LINES = 40

AlertKey = tuple[str, str, str]  # (事件名, 模块, 异常类型)


def _exception_type(record: logging.LogRecord) -> str:
    if record.exc_info and record.exc_info[0] is not None:
        return record.exc_info[0].__name__
    if isinstance(record.msg, dict):
        # structlog 已经把异常格式化成文字：最后一行是 "类型: 说明"
        text = str(record.msg.get("exception") or "").strip()
        if text:
            return text.splitlines()[-1].split(":", 1)[0].strip()[:80]
    return ""


class AlertCollector(logging.Handler):
    """挂在根日志器上，只数 ERROR 以上的日志。"""

    def __init__(self) -> None:
        super().__init__(level=logging.ERROR)
        self._lock = threading.Lock()
        self._counts: Counter[AlertKey] = Counter()

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.msg
        event = str(msg.get("event") or "")[:80] if isinstance(msg, dict) else "-"
        key = (event, record.name, _exception_type(record))
        with self._lock:
            self._counts[key] += 1

    def drain(self) -> list[tuple[AlertKey, int]]:
        with self._lock:
            items = self._counts.most_common()
            self._counts.clear()
        return items


def render_alert(
    items: list[tuple[AlertKey, int]], *, process: str, version: str, minutes: int
) -> tuple[str, str]:
    """(标题, 正文)。运维看的文字，用英文。"""
    total = sum(count for _, count in items)
    host = socket.gethostname()
    subject = f"[BetterTavern] {process}: {total} error(s) in the last {minutes} min"
    lines = [
        f"Host: {host}  Process: {process}  Version: {version}",
        f"Time: {datetime.now().astimezone().isoformat(timespec='seconds')}",
        "",
    ]
    for (event, logger, exc), count in items[:MAX_LINES]:
        suffix = f" [{exc}]" if exc else ""
        lines.append(f"{count:>5} x {event} ({logger}){suffix}")
    if len(items) > MAX_LINES:
        lines.append(f"... and {len(items) - MAX_LINES} more kinds")
    lines += ["", "Details are in the server logs (docker compose logs)."]
    return subject, "\n".join(lines)


class AlertMailer:
    """后台任务：每隔 interval_s 把攒下的报错发一封邮件（没有报错就不发）。"""

    def __init__(
        self,
        mailer: MailSender,
        to: str,
        *,
        process: str,
        version: str,
        interval_s: float = 900.0,
        collector: AlertCollector | None = None,
    ) -> None:
        self.collector = collector or AlertCollector()
        self._mailer = mailer
        self._to = to
        self._process = process
        self._version = version
        self._interval = interval_s

    def install(self) -> None:
        logging.getLogger().addHandler(self.collector)

    def uninstall(self) -> None:
        logging.getLogger().removeHandler(self.collector)

    async def flush(self) -> bool:
        """有报错就发一封；返回发没发。"""
        items = self.collector.drain()
        if not items:
            return False
        subject, text = render_alert(
            items,
            process=self._process,
            version=self._version,
            minutes=max(int(self._interval // 60), 1),
        )
        try:
            await self._mailer.send(Mail(to=self._to, subject=subject, text=text))
        except MailError as exc:
            log.warning("alert.send_failed", reason=str(exc))
            return False
        log.info("alert.sent", kinds=len(items))
        return True

    async def run(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            await self.flush()
