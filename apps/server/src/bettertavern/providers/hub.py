"""ProviderHub：runtime 使用 provider 层的入口。

持有一个共享的 HTTP 客户端（带 SSRF 防护）、厂商注册表、能力规则、能力负缓存和并发限流器。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from .base import ProviderAdapter
from .capabilities import (
    Capabilities,
    CapabilityRule,
    NegativeCapabilityCache,
    load_rules,
    resolve_capabilities,
)
from .limiter import CredentialLimiter
from .registry import ProviderRegistry, default_registry
from .transport import EndpointPolicy, build_http_client


class ProviderHub:
    def __init__(
        self,
        *,
        policy: EndpointPolicy,
        registry: ProviderRegistry | None = None,
        rules: list[CapabilityRule] | None = None,
        limiter: CredentialLimiter | None = None,
        negative_cache: NegativeCapabilityCache | None = None,
        proxy: str | None = None,
        user_agent: str = "BetterTavern",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.policy = policy
        self.registry = registry or default_registry()
        self.rules = rules if rules is not None else load_rules()
        self.limiter = limiter or CredentialLimiter()
        self.negative_cache = negative_cache or NegativeCapabilityCache()
        self._client = client or build_http_client(policy, proxy=proxy, user_agent=user_agent)
        self._adapters: dict[str, ProviderAdapter] = {}

    def adapter(self, provider_id: str) -> ProviderAdapter:
        adapter = self._adapters.get(provider_id)
        if adapter is None:
            adapter = self._adapters[provider_id] = self.registry.create_adapter(
                provider_id, self._client
            )
        return adapter

    def capabilities(
        self,
        provider_id: str,
        model: str,
        *,
        probed: Mapping[str, Any] | None = None,
        override: Mapping[str, Any] | None = None,
    ) -> Capabilities:
        return resolve_capabilities(
            provider_id, model, self.rules, probed=probed, override=override
        )

    async def aclose(self) -> None:
        await self._client.aclose()
