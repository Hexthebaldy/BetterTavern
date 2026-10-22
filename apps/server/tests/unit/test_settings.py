"""配置里和上线有关的几条规则：空值当作没配、要不要验证邮箱、生产环境的发信检查。"""

from __future__ import annotations

import pytest
from pydantic import SecretStr

from bettertavern.entrypoints.bootstrap import mail_sender
from bettertavern.infra.mail.memory import LogSender
from bettertavern.infra.mail.resend import ResendSender
from bettertavern.settings import Settings


def settings(**values: object) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_blank_values_from_compose_count_as_unset() -> None:
    # compose 里没填的变量以空字符串传进来
    s = settings(resend_api_key="", alert_email="  ")
    assert s.resend_api_key is None and s.alert_email is None
    assert not s.email_verification_required


def test_verification_follows_the_mail_key_unless_set() -> None:
    assert settings(resend_api_key=SecretStr("re_x")).email_verification_required
    assert not settings(
        resend_api_key=SecretStr("re_x"), email_verification=False
    ).email_verification_required
    assert settings(email_verification=True).email_verification_required


@pytest.mark.anyio
async def test_mail_sender_by_environment() -> None:
    assert isinstance(mail_sender(settings(env="dev")), LogSender)
    assert mail_sender(settings(env="prod")) is None
    sender = mail_sender(
        settings(env="prod", resend_api_key=SecretStr("re_x"), mail_from="BT <noreply@example.com>")
    )
    assert isinstance(sender, ResendSender)
    await sender.aclose()
    # 生产环境：要求验证邮箱却没配发信，或者发件人没填，启动时就报错
    with pytest.raises(RuntimeError):
        mail_sender(settings(env="prod", email_verification=True))
    with pytest.raises(RuntimeError):
        mail_sender(settings(env="prod", resend_api_key=SecretStr("re_x"), mail_from=""))
