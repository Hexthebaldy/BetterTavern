"""内置的厂商 profile。以后每家厂商一个文件，在这里加到 BUILTIN_PROFILES。"""

from __future__ import annotations

from ..profile import ProviderProfile
from .custom_openai import PROFILE as CUSTOM_OPENAI
from .deepseek import PROFILE as DEEPSEEK
from .gemini import PROFILE as GEMINI
from .huggingface import PROFILE as HUGGINGFACE
from .openai import PROFILE as OPENAI
from .xai import PROFILE as XAI

# 顺序就是“添加模型”里服务商图块的顺序
BUILTIN_PROFILES: tuple[ProviderProfile, ...] = (
    DEEPSEEK,
    OPENAI,
    XAI,
    GEMINI,
    HUGGINGFACE,
    CUSTOM_OPENAI,
)

__all__ = [
    "BUILTIN_PROFILES",
    "CUSTOM_OPENAI",
    "DEEPSEEK",
    "GEMINI",
    "HUGGINGFACE",
    "OPENAI",
    "XAI",
]
