"""一局的提示词语言（docs/i18n.md 第 4 节）：认识的语言原样保留，不认识的按默认的中文。"""

from __future__ import annotations

from bettertavern.domain.story.language import (
    DEFAULT_LANGUAGE,
    PROMPT_LANGUAGES,
    parse_language,
    unnamed_protagonist,
)


def test_known_languages_are_kept() -> None:
    for language in PROMPT_LANGUAGES:
        assert parse_language(language) == language
    assert set(PROMPT_LANGUAGES) == {"zh", "en", "ja"}


def test_unknown_values_fall_back_to_default() -> None:
    for value in ("fr", "", None, "EN", 1):
        assert parse_language(value) == DEFAULT_LANGUAGE == "zh"


def test_unnamed_protagonist_follows_the_language() -> None:
    assert unnamed_protagonist("zh") == "我"
    assert unnamed_protagonist("en") == "I"
    assert unnamed_protagonist("ja") == "私"
    assert unnamed_protagonist("fr") == "我"
