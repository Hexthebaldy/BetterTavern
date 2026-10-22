"""文生图的接口协议（docs/workbench.md 第 6 节）：用户选协议、填地址、模型名和 Key，
就能接任何兼容的服务。

和 providers 的其他部分一样不 import 本项目的其他包；请求走 transport.py 的防内网访问网络层。
"""

from __future__ import annotations

from .base import (
    ASPECT_RATIOS,
    DEFAULT_SIZES,
    MAX_EXTRA_BODY_BYTES,
    STYLE_HINTS,
    Aspect,
    GeneratedImage,
    ImageConfig,
    ImageError,
    ImageProtocol,
    Reference,
)
from .gemini import GeminiImages
from .openai_chat import OpenAIChatImages
from .openai_images import OpenAIImages

IMAGE_PROTOCOLS: dict[str, ImageProtocol] = {
    p.id: p for p in (OpenAIImages(), OpenAIChatImages(), GeminiImages())
}

__all__ = [
    "ASPECT_RATIOS",
    "DEFAULT_SIZES",
    "IMAGE_PROTOCOLS",
    "MAX_EXTRA_BODY_BYTES",
    "STYLE_HINTS",
    "Aspect",
    "GeneratedImage",
    "ImageConfig",
    "ImageError",
    "ImageProtocol",
    "Reference",
]
