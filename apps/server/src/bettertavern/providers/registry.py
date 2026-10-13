"""厂商注册表：profile 按 id 注册，适配器按 profile.adapter 选择。

设置页的厂商下拉由注册表生成，不写死。厂商多了以后，纯声明式的 profile 可以改放 YAML，
由注册表启动时加载。
"""

from __future__ import annotations

from collections.abc import Callable

import httpx

from .base import ProviderAdapter
from .openai_compat import OpenAICompatAdapter
from .profile import ProviderProfile
from .profiles import BUILTIN_PROFILES

AdapterFactory = Callable[[ProviderProfile, httpx.AsyncClient], ProviderAdapter]


class UnknownProvider(KeyError):
    pass


class ProviderRegistry:
    def __init__(self) -> None:
        self._profiles: dict[str, ProviderProfile] = {}
        self._factories: dict[str, AdapterFactory] = {"openai_compat": OpenAICompatAdapter}

    def register_provider(self, profile: ProviderProfile, *, replace: bool = False) -> None:
        if profile.id in self._profiles and not replace:
            raise ValueError(f"厂商 {profile.id!r} 已注册")
        if profile.adapter not in self._factories:
            raise ValueError(f"厂商 {profile.id!r} 指定的适配器 {profile.adapter!r} 未注册")
        self._profiles[profile.id] = profile

    def register_adapter_factory(
        self, name: str, factory: AdapterFactory, *, replace: bool = False
    ) -> None:
        if name in self._factories and not replace:
            raise ValueError(f"适配器 {name!r} 已注册")
        self._factories[name] = factory

    def get(self, provider_id: str) -> ProviderProfile:
        try:
            return self._profiles[provider_id]
        except KeyError:
            raise UnknownProvider(provider_id) from None

    def profiles(self) -> list[ProviderProfile]:
        return list(self._profiles.values())

    def __contains__(self, provider_id: object) -> bool:
        return provider_id in self._profiles

    def create_adapter(self, provider_id: str, client: httpx.AsyncClient) -> ProviderAdapter:
        profile = self.get(provider_id)
        return self._factories[profile.adapter](profile, client)


def default_registry() -> ProviderRegistry:
    registry = ProviderRegistry()
    for profile in BUILTIN_PROFILES:
        registry.register_provider(profile)
    return registry
