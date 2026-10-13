"""ProviderProfile：描述一家厂商，以及它与 OpenAI 协议之间少数几处差异的钩子。

新增一家厂商分三档（见 docs/backend.md “新增一家厂商”）：
1. 兼容 OpenAI 协议，只是基址、认证、模型名不同：写一个 profile，在 capabilities.yaml 加规则；
2. 字段有差异：在 profile 里覆盖 prepare_body / parse_usage / parse_reasoning / parse_model；
3. 协议不兼容：实现 ProviderAdapter，在 profile.adapter 里指明用哪个适配器。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .base import ChatRequest, ModelInfo, ResolvedCredential, Usage
from .capabilities import Capabilities
from .usage import normalize_usage


@dataclass(frozen=True)
class ProviderProfile:
    id: str
    display_name: str
    default_base_url: str | None
    requires_base_url: bool = False
    chat_path: str = "/chat/completions"
    models_path: str = "/models"
    adapter: str = "openai_compat"

    def base_url(self, cred: ResolvedCredential) -> str:
        url = cred.base_url or self.default_base_url
        if not url:
            raise ValueError(f"{self.display_name} 需要填写基址")
        return url.rstrip("/")

    def auth_headers(self, cred: ResolvedCredential) -> dict[str, str]:
        return {"Authorization": f"Bearer {cred.api_key.reveal()}"}

    def prepare_body(
        self, body: dict[str, Any], req: ChatRequest, caps: Capabilities
    ) -> dict[str, Any]:
        """在通用请求体上补厂商特有的字段。默认只处理 OpenAI 风格的 reasoning_effort。"""
        reasoning = req.reasoning
        if (
            reasoning is not None
            and reasoning.enabled
            and reasoning.effort
            and caps.reasoning.control == "effort"
            and (not caps.reasoning.efforts or reasoning.effort in caps.reasoning.efforts)
        ):
            body["reasoning_effort"] = reasoning.effort
        return body

    def parse_reasoning(self, delta: Mapping[str, Any]) -> str | None:
        for key in ("reasoning_content", "reasoning"):
            value = delta.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    def parse_usage(self, raw: Mapping[str, Any] | None) -> Usage | None:
        return normalize_usage(raw)

    def parse_model(self, item: Mapping[str, Any]) -> ModelInfo | None:
        model_id = item.get("id")
        if not isinstance(model_id, str) or not model_id:
            return None
        window = item.get("context_length", item.get("context_window"))
        owned_by = item.get("owned_by")
        return ModelInfo(
            id=model_id,
            context_window=window if isinstance(window, int) and window > 0 else None,
            owned_by=owned_by if isinstance(owned_by, str) else None,
        )
