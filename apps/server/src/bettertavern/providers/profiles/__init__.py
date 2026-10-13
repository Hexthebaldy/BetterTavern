"""内置的厂商 profile。以后每家厂商一个文件，在这里加到 BUILTIN_PROFILES。"""

from __future__ import annotations

from ..profile import ProviderProfile
from .custom_openai import PROFILE as CUSTOM_OPENAI
from .deepseek import PROFILE as DEEPSEEK
from .huggingface import PROFILE as HUGGINGFACE

BUILTIN_PROFILES: tuple[ProviderProfile, ...] = (DEEPSEEK, HUGGINGFACE, CUSTOM_OPENAI)

__all__ = ["BUILTIN_PROFILES", "CUSTOM_OPENAI", "DEEPSEEK", "HUGGINGFACE"]
