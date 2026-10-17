"""一局的提示词语言（docs/i18n.md 第 4 节）：开局时由客户端按界面语言传来，
存在 playthroughs.language，之后不变。

它只决定给 agent 的提示词用哪种语言；故事正文的语言不做规定。
"""

from __future__ import annotations

from typing import Literal

PromptLanguage = Literal["zh", "en"]

PROMPT_LANGUAGES: tuple[PromptLanguage, ...] = ("zh", "en")
DEFAULT_LANGUAGE: PromptLanguage = "zh"


def parse_language(value: object) -> PromptLanguage:
    """库里或请求里的值；不认识的按默认语言"""
    if value == "en":
        return "en"
    return DEFAULT_LANGUAGE


def unnamed_protagonist(language: str) -> str:
    """没有名字时怎么称呼主角（开局时名字必填，只在旧数据里兜底）"""
    return "I" if language == "en" else "我"
