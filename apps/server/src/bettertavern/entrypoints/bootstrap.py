"""api 和 worker 两个进程共用的组装步骤：密钥、出站策略、provider 层。"""

from __future__ import annotations

import structlog

from bettertavern import __version__
from bettertavern.infra.crypto.keyring import AppSecrets, load_secrets
from bettertavern.providers import EndpointPolicy, ProviderHub
from bettertavern.providers.limiter import CredentialLimiter, LimiterConfig
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
