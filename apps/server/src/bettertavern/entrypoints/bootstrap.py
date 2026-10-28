"""api 和 worker 两个进程共用的组装步骤：密钥、出站策略、provider 层、发信、用量上限。"""

from __future__ import annotations

import structlog

from bettertavern import __version__
from bettertavern.domain.billing import TokenPrices
from bettertavern.infra.crypto.keyring import AppSecrets, load_secrets
from bettertavern.infra.mail import MailSender
from bettertavern.infra.mail.memory import LogSender
from bettertavern.infra.mail.resend import ResendSender
from bettertavern.infra.observability.alerts import AlertMailer
from bettertavern.providers import EndpointPolicy, ProviderHub, Secret
from bettertavern.providers.limiter import CredentialLimiter, LimiterConfig
from bettertavern.runtime.ports import ToolConfig
from bettertavern.runtime.prompts import PromptBook
from bettertavern.services.auth_service import AccountPolicy
from bettertavern.services.credits import CreditPolicy
from bettertavern.services.platform import PlatformModel
from bettertavern.services.quotas import Quotas
from bettertavern.settings import Settings

log = structlog.get_logger(__name__)


def app_secrets(settings: Settings) -> AppSecrets:
    secrets = load_secrets(
        master_keys=settings.master_keys.get_secret_value() if settings.master_keys else None,
        auth_secret=settings.auth_secret.get_secret_value() if settings.auth_secret else None,
        allow_dev_fallback=not settings.is_prod,
        data_dir=settings.data_dir,
    )
    if secrets.generated_dev_file is not None:
        # 开发环境用自动生成的密钥；生产环境必须配置
        log.warning("secrets.dev_generated", file=str(secrets.generated_dev_file))
    return secrets


def endpoint_policy(settings: Settings) -> EndpointPolicy:
    ranges = tuple(r.strip() for r in settings.fake_ip_ranges.split(",") if r.strip())
    return EndpointPolicy(allow_private=settings.allow_private_endpoints, fake_ip_ranges=ranges)


def provider_hub(settings: Settings, policy: EndpointPolicy) -> ProviderHub:
    return ProviderHub(
        policy=policy,
        proxy=settings.outbound_proxy,
        limiter=CredentialLimiter(LimiterConfig(capacity=settings.credential_concurrency)),
        user_agent=f"BetterTavern/{__version__}",
    )


def mail_sender(settings: Settings) -> MailSender | None:
    """配了 RESEND_API_KEY 走 Resend；开发和测试环境没配时把验证码写进日志；生产环境没配就不发信
    （这时不能要求验证邮箱，也用不了找回密码）。"""
    if settings.resend_api_key is not None:
        if settings.is_prod and (
            not settings.mail_from.strip() or "@localhost" in settings.mail_from
        ):
            raise RuntimeError("Set MAIL_FROM to an address on a domain verified in Resend")
        # 注册、找回密码时接口直接等发信结果，超时不能太长
        return ResendSender(
            settings.resend_api_key.get_secret_value(), settings.mail_from, timeout_s=5.0
        )
    if settings.is_prod:
        if settings.email_verification_required:
            raise RuntimeError("EMAIL_VERIFICATION is on but RESEND_API_KEY isn't set")
        return None
    return LogSender()


def prompt_book(settings: Settings) -> PromptBook:
    return PromptBook(content_policy=settings.content_policy)


def account_policy(settings: Settings) -> AccountPolicy:
    return AccountPolicy(
        verification_required=settings.email_verification_required,
        registration_open=settings.registration_open,
    )


def quotas(settings: Settings) -> Quotas:
    return Quotas(
        max_running_agents=settings.max_running_agents,
        max_open_drafts=settings.max_open_drafts,
        max_lorebooks=settings.max_lorebooks,
        max_personas=settings.max_personas,
        max_image_bytes=settings.max_image_bytes_per_user,
        platform_searches_per_day=settings.platform_search_daily,
        platform_searches_per_month=settings.platform_search_monthly,
    )


def platform_search(settings: Settings) -> ToolConfig | None:
    """配了 PLATFORM_SEARCH_API_KEY 才有官方搜索。"""
    if settings.platform_search_api_key is None:
        return None
    return ToolConfig(
        route_id=f"platform:{settings.platform_search_provider}",
        kind="search",
        provider=settings.platform_search_provider,
        label="official",
        api_key=settings.platform_search_api_key.get_secret_value(),
    )


def alert_mailer(settings: Settings, mailer: MailSender | None, process: str) -> AlertMailer | None:
    """配了 ALERT_EMAIL 和发信服务时，报错合成邮件定期发出去。"""
    if not settings.alert_email or mailer is None:
        return None
    return AlertMailer(
        mailer,
        settings.alert_email,
        process=process,
        version=__version__,
        interval_s=settings.alert_interval_s,
    )


def platform_model(settings: Settings) -> PlatformModel | None:
    """配了 PLATFORM_API_KEY 才有官方模型。"""
    if settings.platform_api_key is None:
        return None
    return PlatformModel(
        provider=settings.platform_provider,
        model=settings.platform_model,
        api_key=Secret(settings.platform_api_key.get_secret_value()),
        base_url=settings.platform_base_url,
        prices=TokenPrices(
            input=settings.platform_price_input,
            cached=settings.platform_price_cached,
            output=settings.platform_price_output,
        ),
        concurrency=settings.platform_concurrency,
    )


def credit_policy(settings: Settings) -> CreditPolicy:
    return CreditPolicy(
        trial_points=settings.trial_credits,
        daily_budget_micro=round(settings.platform_daily_budget * 1_000_000),
        default_turn_points=settings.platform_turn_points,
    )
