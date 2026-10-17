"""OpenAI：Chat Completions，基址 https://api.openai.com/v1。

依据 developers.openai.com 的各模型页、推理指南和 Chat Completions 参考（2026-10 读）：
- max_tokens 已废弃、o 系列不认，改用 max_completion_tokens（推理加正文的总量），一律改名。
- 推理强度用 reasoning_effort（基类处理）。推理开着时要去掉 temperature、top_p；
  能把推理关掉（effort 有 none）的模型在“深度思考”关掉时发 none，这时才保留 temperature、top_p；
  关不掉的模型一直去掉。
- 模型列表里还有嵌入、语音、转写、图片、实时、审核等模型，
  只留能用 Chat Completions 对话的（gpt-*、o*、chatgpt-*）；*-pro 只支持 Responses 接口，也不列。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..base import ChatRequest, ModelInfo
from ..capabilities import Capabilities
from ..profile import ProviderProfile

_CHAT_FAMILY = re.compile(r"^(gpt-|o\d|chatgpt-)", re.IGNORECASE)
_NOT_CHAT = re.compile(
    r"embedding|tts|transcribe|whisper|realtime|audio|image|dall-e|moderation|instruct|search|codex|sora"
    r"|-pro(?:-|$)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class OpenAIProfile(ProviderProfile):
    def prepare_body(
        self, body: dict[str, Any], req: ChatRequest, caps: Capabilities
    ) -> dict[str, Any]:
        body = super().prepare_body(body, req, caps)
        if "max_tokens" in body:
            body["max_completion_tokens"] = body.pop("max_tokens")
        if caps.reasoning.control == "effort":
            reasoning = req.reasoning
            if reasoning is not None and not reasoning.enabled and "none" in caps.reasoning.efforts:
                body["reasoning_effort"] = "none"
            else:
                body.pop("temperature", None)
                body.pop("top_p", None)
        return body

    def parse_model(self, item: Mapping[str, Any]) -> ModelInfo | None:
        info = super().parse_model(item)
        if info is None or not _CHAT_FAMILY.match(info.id) or _NOT_CHAT.search(info.id):
            return None
        return info


PROFILE = OpenAIProfile(
    id="openai",
    display_name="OpenAI",
    default_base_url="https://api.openai.com/v1",
)
