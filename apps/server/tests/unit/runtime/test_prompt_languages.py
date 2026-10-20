"""每种语言一套提示词（docs/i18n.md 第 4 节）：文件一一对应、模板用到的变量相同、数据文件的键相同；
两种语言都能渲染，英文的一局拿到的上下文是英文的。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jinja2
import pytest
from jinja2 import meta

from bettertavern.domain.story.language import PROMPT_LANGUAGES
from bettertavern.domain.world.seed import Seed
from bettertavern.runtime.context.assembler import ContextAssembler
from bettertavern.runtime.context.state_block import render_state_block
from bettertavern.runtime.prompts import PROMPTS_ROOT, PromptBook, PromptLibrary
from bettertavern.runtime.protocol.structured import schema_of
from tests.unit.runtime.test_context import WORLD, context


def files(language: str) -> list[str]:
    root = PROMPTS_ROOT / language
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


def variables(language: str, name: str) -> set[str]:
    env = jinja2.Environment()
    source = (PROMPTS_ROOT / language / name).read_text(encoding="utf-8")
    return meta.find_undeclared_variables(env.parse(source))


def shape(value: Any) -> Any:
    """数据文件的结构：只比键，不比文字"""
    if isinstance(value, dict):
        return {k: shape(v) for k, v in value.items()}
    return type(value).__name__


def test_every_language_has_the_same_files() -> None:
    expected = files("zh")
    assert any(f.endswith(".j2") for f in expected)
    for language in PROMPT_LANGUAGES:
        assert files(language) == expected, language


@pytest.mark.parametrize("name", [f for f in files("zh") if f.endswith(".j2")])
def test_templates_use_the_same_variables(name: str) -> None:
    for language in PROMPT_LANGUAGES:
        assert variables(language, name) == variables("zh", name), (language, name)


@pytest.mark.parametrize("name", [f for f in files("zh") if f.endswith(".json")])
def test_data_files_have_the_same_keys(name: str) -> None:
    def load(language: str) -> Any:
        return json.loads((PROMPTS_ROOT / language / name).read_text(encoding="utf-8"))

    for language in PROMPT_LANGUAGES:
        assert shape(load(language)) == shape(load("zh")), (language, name)


def test_schema_notes_name_real_fields() -> None:
    schema = Seed.model_json_schema()
    for language in PROMPT_LANGUAGES:
        notes = PromptLibrary(language).data("schema/seed")["fields"]
        for key in notes:
            owner, _, field = key.partition(".")
            holder = schema if owner == schema["title"] else schema["$defs"][owner]
            assert field in holder["properties"], (language, key)
        described = schema_of(Seed, notes)
        assert described["$defs"]["WorldSeed"]["properties"]["title"]["description"]


def test_state_block_follows_the_language() -> None:
    zh = render_state_block(WORLD, PromptLibrary("zh"))
    en = render_state_block(WORLD, PromptLibrary("en"))
    assert "【在场人物】" in zh and "【" not in en
    assert "[Present]\n- 老周" in en and "attitude toward me: 警惕" in en
    assert "北境商会 (group)" in en
    assert en.startswith("<world-state>\nBelow is the world state at the start of the story")
    later = render_state_block(WORLD, PromptLibrary("en"), state_seq=4)
    assert later.startswith("<world-state>\nBelow is the world state as of turn 4 ")


def test_state_block_in_japanese() -> None:
    ja = render_state_block(WORLD, PromptLibrary("ja"))
    assert ja.startswith("<world-state>\n以下は物語開始時点の世界の状態です")
    later = render_state_block(WORLD, PromptLibrary("ja"), state_seq=4)
    assert later.startswith("<world-state>\n以下は第 4 ターン時点の世界の状態です")
    assert "【その場にいる人物】\n- 老周" in ja and "主人公への態度：警惕" in ja
    assert "北境商会（組織）" in ja
    # 秘密那一节的标题和系统提示词里说的“監督のみ閲覧可”是同一个说法
    assert "監督のみ閲覧可" in PromptLibrary("ja").render("director.system", **system_values()).text


def test_japanese_context_is_japanese_and_deterministic() -> None:
    assembler = ContextAssembler(PromptLibrary("ja"))
    first = assembler.assemble(context(history=2), 64_000)
    second = ContextAssembler(PromptLibrary("ja")).assemble(context(history=2), 64_000)
    assert first.messages == second.messages
    system = first.messages[0].content
    assert system.startswith("あなたは一人称で語られるインタラクティブ小説の監督です")
    assert "1回あたり200〜400字程度" in system
    assert "灰石镇" in system  # 故事设定原样带上，不翻译
    assert first.messages[-1].content.endswith("選択肢はちょうど2つにすること。）")


def system_values() -> dict[str, Any]:
    return {
        "protagonist": {"name": "林川", "description": ""},
        "title": "",
        "world": "",
        "rules": [],
        "characters": [],
        "style": "",
        "boundaries": "",
        "length": "medium",
    }


def test_english_context_is_english_and_deterministic() -> None:
    assembler = ContextAssembler(PromptLibrary("en"))
    first = assembler.assemble(context(history=2), 64_000)
    second = ContextAssembler(PromptLibrary("en")).assemble(context(history=2), 64_000)
    assert first.messages == second.messages
    system = first.messages[0].content
    assert system.startswith("You are the director") and "about 80 to 150 words" in system
    assert "灰石镇" in system  # 故事设定原样带上，不翻译
    assert first.messages[-1].content.endswith("with exactly 2 choices.)")


def test_every_template_renders_in_every_language() -> None:
    samples: dict[str, dict[str, Any]] = {
        "director.turn": {"action": "push", "world_state": ""},
        "director.ending": {"wish": "", "world_state": ""},
        "options_repair": {"narrative": "rain", "existing": ["wait"], "count": 2},
        "structured_retry": {"error": "x"},
    }
    for language in PROMPT_LANGUAGES:
        library = PromptLibrary(language)
        for name, values in samples.items():
            assert library.render(name, **values).text, (language, name)


def test_unknown_language_falls_back_to_default() -> None:
    book = PromptBook()
    assert set(book.languages) == set(PROMPT_LANGUAGES)
    assert book.get("fr").language == "zh"
    assert book.get("en").language == "en"


def test_prompt_directories_exist_for_every_language() -> None:
    for language in PROMPT_LANGUAGES:
        assert Path(PROMPTS_ROOT / language).is_dir()
