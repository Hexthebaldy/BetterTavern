"""发信：验证码邮件的文字（三种语言）、经 Resend 发出去的请求、失败时的处理；报错提醒的合并。"""

from __future__ import annotations

import json
import logging

import httpx
import pytest
import structlog

from bettertavern.infra.mail import Mail, MailError
from bettertavern.infra.mail.memory import MemorySender
from bettertavern.infra.mail.render import code_mail
from bettertavern.infra.mail.resend import ResendSender
from bettertavern.infra.observability.alerts import AlertCollector, AlertMailer
from bettertavern.infra.observability.logging import configure_logging

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    ("language", "verify_word", "reset_word"),
    [("zh", "验证码", "重置"), ("en", "sign-up", "reset"), ("ja", "確認コード", "再設定")],
)
def test_code_mail_in_each_language(language: str, verify_word: str, reset_word: str) -> None:
    verify = code_mail("lin@example.com", "verify", "042517", language, 15)
    assert verify.to == "lin@example.com" and verify.dev_code == "042517"
    assert "042517" in verify.subject and "042517" in verify.text and "15" in verify.text
    assert verify_word in verify.subject + verify.text
    assert "<strong" in verify.html and "042517" in verify.html
    reset = code_mail("lin@example.com", "reset", "042517", language, 15)
    assert reset_word in reset.subject + reset.text and reset.subject != verify.subject


def test_unknown_language_falls_back_to_chinese() -> None:
    assert (
        code_mail("a@b.cd", "verify", "1", "fr", 15).subject
        == code_mail("a@b.cd", "verify", "1", None, 15).subject
        == code_mail("a@b.cd", "verify", "1", "zh", 15).subject
    )


async def test_resend_request_and_errors() -> None:
    seen: list[httpx.Request] = []
    status = 200

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if status == 200:
            return httpx.Response(200, json={"id": "e_1"})
        return httpx.Response(status, json={"name": "rate_limit_exceeded", "message": "slow down"})

    sender = ResendSender(
        "re_test", "BetterTavern <noreply@example.com>", transport=httpx.MockTransport(handler)
    )
    await sender.send(Mail(to="lin@example.com", subject="Hi", text="Body", html="<p>Body</p>"))
    request = seen[-1]
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["authorization"] == "Bearer re_test"
    assert json.loads(request.content) == {
        "from": "BetterTavern <noreply@example.com>",
        "to": ["lin@example.com"],
        "subject": "Hi",
        "text": "Body",
        "html": "<p>Body</p>",
    }
    status = 429
    with pytest.raises(MailError, match="429 rate_limit_exceeded"):
        await sender.send(Mail(to="lin@example.com", subject="Hi", text="Body"))
    await sender.aclose()


async def test_resend_network_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    sender = ResendSender("re_test", "a@example.com", transport=httpx.MockTransport(handler))
    with pytest.raises(MailError):
        await sender.send(Mail(to="lin@example.com", subject="Hi", text="Body"))
    await sender.aclose()


async def test_alerts_merge_errors_without_details() -> None:
    configure_logging(level="INFO", process="api", fmt="json", cache=False)
    mail = MemorySender()
    alerts = AlertMailer(
        mail, "ops@example.com", process="api", version="1.2.3", collector=AlertCollector()
    )
    alerts.install()
    try:
        log = structlog.get_logger("bettertavern.services.turn_service")
        for _ in range(3):
            log.error("turn.failed", story_text="她葬花吟诗", api_key="sk-secret")
        try:
            raise ValueError("boom with user text")
        except ValueError:
            log.exception("job.crashed")
        log.warning("only.a.warning")
        logging.getLogger("uvicorn.error").error("Exception in ASGI application")
        assert await alerts.flush()
        assert not await alerts.flush()  # 没有新的报错就不发
    finally:
        alerts.uninstall()
    [sent] = mail.sent
    assert sent.to == "ops@example.com" and "5 error(s)" in sent.subject
    assert "3 x turn.failed (bettertavern.services.turn_service)" in sent.text
    assert "1 x job.crashed (bettertavern.services.turn_service) [ValueError]" in sent.text
    assert "1 x - (uvicorn.error)" in sent.text
    # 只有事件名和次数：字段、异常说明、警告都不进邮件
    for leaked in ("她葬花吟诗", "sk-secret", "boom with user text", "only.a.warning"):
        assert leaked not in sent.text


async def test_alert_mail_failure_does_not_raise() -> None:
    configure_logging(level="INFO", process="worker", fmt="json", cache=False)
    mail = MemorySender()
    mail.fail = True
    alerts = AlertMailer(mail, "ops@example.com", process="worker", version="1")
    alerts.install()
    try:
        structlog.get_logger("x").error("job.failed")
        assert not await alerts.flush()
    finally:
        alerts.uninstall()
