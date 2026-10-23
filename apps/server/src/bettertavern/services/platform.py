"""官方模型：运营方自己的 Key，给不会配置模型的用户直接用（官方服务 bettertavern.com）。

- 服务器配置了 PLATFORM_API_KEY 才有；自己部署的一般不配，就没有官方模型；
- 每个用户在 model_routes 里有一行 source = platform，不存 Key，调用时用这里的；
- 用量按 prices 换成点数，从用户的余额里扣（services/credits.py）；
- 所有用户共用这一把 Key，限流的上限单独设（concurrency），不用默认的每把 Key 4 个。
"""

from __future__ import annotations

from dataclasses import dataclass

from bettertavern.domain.billing import TokenPrices
from bettertavern.providers import ProviderHub, ResolvedCredential, Secret
from bettertavern.providers.limiter import LimiterConfig

from .route_inputs import key_fingerprint


@dataclass(frozen=True)
class PlatformModel:
    provider: str
    model: str
    api_key: Secret
    prices: TokenPrices
    base_url: str | None = None
    concurrency: int = 32

    @property
    def credential_id(self) -> str:
        return "platform:" + key_fingerprint(self.provider, self.api_key.reveal())

    def credential(self) -> ResolvedCredential:
        return ResolvedCredential(
            credential_id=self.credential_id,
            provider=self.provider,
            api_key=self.api_key,
            base_url=self.base_url,
        )

    def register(self, hub: ProviderHub) -> None:
        """给这把 Key 设单独的并发上限；api 和 worker 启动时各调一次。"""
        reserved = max(1, self.concurrency // 4)
        hub.limiter.configure(
            self.credential_id,
            LimiterConfig(capacity=self.concurrency, reserved_interactive=reserved),
        )
