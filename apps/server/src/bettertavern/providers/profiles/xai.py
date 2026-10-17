"""xAI（Grok）：OpenAI 兼容的 Chat Completions，基址 https://api.x.ai/v1。

基址要带 /v1，不然路径不对。依据 docs.x.ai 的模型页和推理指南（2026-10 读）：
- 推理模型不接受 stop、presence_penalty、frequency_penalty，带了直接报错；
  名字里不带 non-reasoning 的都按推理模型处理，这几个字段去掉。
- grok-4.5 / 4.6 / 4.7 可以用 reasoning_effort（low / medium / high / xhigh，不传是 high），
  推理关不掉；其余模型不收这个参数（能力表里不给它们 effort）。
- 模型列表里还有生成图片、视频、语音的模型（grok-imagine-*、grok-voice-*），
  以及不支持 Chat Completions 的多智能体模型（*multi-agent*），都不列出来。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..base import ChatRequest, ModelInfo
from ..capabilities import Capabilities
from ..profile import ProviderProfile

_NOT_CHAT = re.compile(r"^grok-(imagine|voice)\b|multi-agent", re.IGNORECASE)
_REJECTED_BY_REASONING = ("stop", "presence_penalty", "frequency_penalty")


@dataclass(frozen=True)
class XAIProfile(ProviderProfile):
    def prepare_body(
        self, body: dict[str, Any], req: ChatRequest, caps: Capabilities
    ) -> dict[str, Any]:
        body = super().prepare_body(body, req, caps)
        if "non-reasoning" not in req.model.lower():
            for key in _REJECTED_BY_REASONING:
                body.pop(key, None)
        return body

    def parse_model(self, item: Mapping[str, Any]) -> ModelInfo | None:
        info = super().parse_model(item)
        if info is None or _NOT_CHAT.search(info.id):
            return None
        return info


PROFILE = XAIProfile(
    id="xai",
    display_name="Grok",
    default_base_url="https://api.x.ai/v1",
)
