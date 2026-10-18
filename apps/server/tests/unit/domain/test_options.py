from __future__ import annotations

from bettertavern.domain.story.options import (
    MAX_OPTION_CHARS,
    clean_option,
    fallback_options,
    normalize_options,
)


def test_clean_option_strips_markup_and_quotes() -> None:
    assert clean_option("  **走向柜台**  ") == "走向柜台"
    assert clean_option("“先敲门”") == "先敲门"
    assert clean_option("「先敲门」") == "先敲门"
    assert clean_option("进去\n  看看") == "进去 看看"
    assert clean_option("   ") is None
    assert clean_option("长" * (MAX_OPTION_CHARS + 1)) is None


def test_normalize_dedupes_and_limits() -> None:
    raw = ["进去", "Go", "go", "进去", "离开"]
    assert normalize_options(raw) == ["进去", "Go", "离开"]
    assert normalize_options(raw, limit=2) == ["进去", "Go"]


def test_fallback_options_default_to_chinese() -> None:
    assert fallback_options("zh") == fallback_options("xx")
    assert len(fallback_options("en")) == 2
    japanese = fallback_options("ja")
    assert len(japanese) == 2 and japanese != fallback_options("zh")
