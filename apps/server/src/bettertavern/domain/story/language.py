"""一局的故事语言（docs/i18n.md 第 1、4 节）：开局时玩家在表单里选（默认是界面语言），
存在 playthroughs.language，之后不变。

给 agent 的提示词按它选，提示词里也写明正文、对白、选项和世界状态用这种语言写。
"""

from __future__ import annotations

from typing import Literal, cast

PromptLanguage = Literal["zh", "en", "ja"]

PROMPT_LANGUAGES: tuple[PromptLanguage, ...] = ("zh", "en", "ja")
DEFAULT_LANGUAGE: PromptLanguage = "zh"

# 没有名字时怎么称呼主角（开局时名字必填，只在旧数据里兜底）
_UNNAMED: dict[str, str] = {"zh": "我", "en": "I", "ja": "私"}


def parse_language(value: object) -> PromptLanguage:
    """库里或请求里的值；不认识的按默认语言"""
    if value in PROMPT_LANGUAGES:
        return cast(PromptLanguage, value)
    return DEFAULT_LANGUAGE


def unnamed_protagonist(language: str) -> str:
    return _UNNAMED.get(language, _UNNAMED[DEFAULT_LANGUAGE])
