"""剧本的设置：规整形状和长度，检查开场白指向的卡和编号。"""

from __future__ import annotations

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.scenario.setup import Opening, ScenarioSetup, opening_problem

LIN = CharacterCard(
    spec="card_v3", name="林黛玉", first_mes="元宵夜……", alternate_greetings=("", "葬花")
)


def test_empty_setup_has_defaults() -> None:
    setup = ScenarioSetup.from_json({})
    assert setup.to_json() == {
        "protagonist": {"name": "", "summary": ""},
        "preferences": {"length": "medium", "style": "", "boundaries": ""},
        "opening": None,
    }


def test_setup_is_trimmed_and_clamped() -> None:
    setup = ScenarioSetup.from_json(
        {
            "protagonist": {"name": "  宝玉 " + "长" * 50, "summary": "荣国府的二公子"},
            "preferences": {"length": "huge", "style": "白描", "boundaries": "不写血腥\x00"},
            "opening": {"card_id": "c1", "greeting": "2"},
        }
    )
    assert setup.protagonist_name.startswith("宝玉") and len(setup.protagonist_name) == 40
    assert setup.length == "medium"
    assert setup.boundaries == "不写血腥"
    assert setup.opening == Opening(card_id="c1", greeting=2)


def test_opening_must_point_at_an_existing_greeting() -> None:
    cards = [("c1", LIN)]
    assert opening_problem(None, cards) is None
    assert opening_problem(Opening("c1", 0), cards) is None
    assert opening_problem(Opening("c1", 2), cards) is None
    assert opening_problem(Opening("c1", 1), cards) is not None  # 空的那条
    assert opening_problem(Opening("c1", 3), cards) is not None
    assert opening_problem(Opening("c2", 0), cards) is not None
