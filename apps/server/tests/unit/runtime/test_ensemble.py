"""群像剧本：几张卡一起交给 WorldBuilder（世界书合并、重名取第一张的），每个角色都建成人物；
剧本设置里选了开场白时，开场就是那条开场白（宏换成名字）。"""

from __future__ import annotations

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry, greeting_narrative
from bettertavern.domain.world.seed import (
    CharacterSeed,
    ProtagonistSeed,
    Seed,
    minimal_seed,
    normalize_seed,
)
from bettertavern.runtime.agents.world_builder import merged_book, render_prompt_context
from bettertavern.runtime.ports import Preferences, WorldBuildInput
from bettertavern.runtime.prompts import PromptLibrary

WEN = CharacterCard(
    spec="card_v3",
    name="温九",
    description="{{char}} 是长生当的掌柜。",
    first_mes="（{{char}} 抬眼）{{user}}，当什么？",
    book=(
        LoreEntry(name="长生当", keys=("当铺",), content="城南的当铺", order=0),
        LoreEntry(name="规矩", content="三不当", constant=True, order=1),
    ),
)
QI = CharacterCard(
    spec="card_v3",
    name="阿七",
    description="{{char}} 是当铺的伙计，怕 {{user}}。",
    alternate_greetings=("*阿七探出头* {{user}}，掌柜不在。",),
    book=(
        LoreEntry(name="规矩", content="伙计记的另一版规矩", order=0),
        LoreEntry(name="后院", keys=("后院",), content="{{char}} 不敢去后院", order=1),
    ),
)


def inp(**changes: object) -> WorldBuildInput:
    base = WorldBuildInput(
        card=WEN,
        protagonist_name="林川",
        protagonist_summary="",
        preferences=Preferences(),
        cards=(WEN, QI),
    )
    return WorldBuildInput(**{**base.__dict__, **changes})  # type: ignore[arg-type]


def test_lorebooks_merge_and_the_first_card_wins_on_duplicate_names() -> None:
    merged = merged_book([WEN, QI])
    assert [(e.name, owner) for e, owner in merged] == [
        ("长生当", "温九"),
        ("规矩", "温九"),
        ("后院", "阿七"),
    ]


def test_world_builder_prompt_lists_every_card() -> None:
    context = render_prompt_context(WEN, inp())
    others = context["others"]
    assert isinstance(others, list) and others[0]["name"] == "阿七"
    assert "林川" in others[0]["description"]  # 每张卡的宏按自己的角色名换
    book = context["book"]
    assert isinstance(book, list)
    assert [b["content"] for b in book] == ["三不当", "城南的当铺", "阿七 不敢去后院"]
    assert context["opening_chosen"] is False
    text = PromptLibrary("zh").render("world_builder", schema="", **context).text
    assert "群像故事" in text and "另一位关键人物：阿七" in text
    assert "“温九”、“阿七”必须在内" in text


def test_chosen_opening_is_passed_as_the_start_of_the_story() -> None:
    context = render_prompt_context(
        WEN, inp(opening=QI.alternate_greetings[0], opening_char="阿七")
    )
    assert context["opening_chosen"] is True
    assert context["first_mes"] == "*阿七探出头* 林川，掌柜不在。"
    for language in ("zh", "en", "ja"):
        PromptLibrary(language).render("world_builder", schema="", **context)


def test_every_card_character_ends_up_in_the_seed() -> None:
    seed = normalize_seed(
        Seed(protagonist=ProtagonistSeed(name="x"), characters=[CharacterSeed(name="温九")]),
        protagonist_name="林川",
        card_name="温九",
        other_names=["阿七"],
    )
    assert [c.name for c in seed.characters] == ["温九", "阿七"]
    fallback = minimal_seed(WEN, protagonist_name="林川", others=[QI])
    assert [c.name for c in fallback.characters] == ["温九", "阿七"]
    assert fallback.characters[1].summary.startswith("阿七 是当铺的伙计")


def test_greeting_narrative_replaces_macros_and_actions() -> None:
    assert greeting_narrative(QI.alternate_greetings[0], user="林川", char="阿七") == (
        "（阿七探出头）林川，掌柜不在。"
    )
    assert greeting_narrative("*waves* Hi {{user}}.", user="Lin", char="Qi") == "(waves) Hi Lin."
