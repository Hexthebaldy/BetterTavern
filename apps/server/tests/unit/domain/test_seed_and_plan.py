from __future__ import annotations

import pytest

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.story.turn import (
    ActionError,
    PlayerAction,
    TurnOption,
    clip_middle,
    resolve_action,
)
from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.plan import REL_HELD_BY, REL_LOCATED_IN, entity_key, plan_world
from bettertavern.domain.world.seed import Seed, minimal_seed, normalize_seed

RAW_SEED = {
    "world": {"title": "雨夜", "setting": "小镇", "rules": ["规则一"] * 12},
    "protagonist": {"name": "模型起的名字", "summary": "信使"},
    "characters": [
        {"name": "老周", "summary": "掌柜", "importance": 9},
        {"name": " 老周 ", "summary": "重复的"},
        {"name": "林川", "summary": "和主角同名的 NPC 要去掉"},
        {"name": "", "summary": "没名字"},
    ],
    "locations": [{"name": "酒馆"}, {"name": "码头"}],
    "items": [
        {"name": "信", "holder": "林川"},
        {"name": "钥匙", "holder": "不存在的人", "location": "码头"},
        {"name": "地图", "location": "不存在的地方"},
    ],
    "organizations": [{"name": "北境商会", "members": ["老周", "路人"]}],
    "facts": [
        {
            "text": "老周欠钱",
            "about": ["老周", "北境商会"],
            "secret": True,
            "known_by": ["老周", "酒馆"],
        },
        {"text": "", "about": []},
    ],
    "opening": {"location": "酒馆", "present": ["老周", "林川", "鬼"], "situation": "雨夜"},
}


def normalized() -> Seed:
    return normalize_seed(Seed.model_validate(RAW_SEED), protagonist_name="林川", card_name="阿苓")


def test_normalize_seed_fixes_names_and_references() -> None:
    seed = normalized()
    assert seed.protagonist.name == "林川"
    assert [c.name for c in seed.characters] == ["阿苓", "老周"]  # 角色卡主角色补上，主角同名的去掉
    assert seed.characters[1].importance == 5  # 超出范围的重要度被夹住
    assert len(seed.world.rules) == 8
    items = {i.name: i for i in seed.items}
    assert items["信"].holder == "林川"
    assert items["钥匙"].holder is None and items["钥匙"].location == "码头"
    assert items["地图"].location is None
    assert seed.organizations[0].members == ["老周"]
    assert len(seed.facts) == 1
    assert seed.facts[0].about == ["老周", "北境商会"]
    assert seed.facts[0].known_by == ["老周"]  # 只有人物能“知道”
    assert seed.opening.location == "酒馆"
    assert seed.opening.present == ["老周"]


def test_plan_world_links_scene_and_facts() -> None:
    plan = plan_world(normalized())
    kinds = [e.kind for e in plan.entities]
    assert kinds.count("world") == 1
    hero = next(e for e in plan.entities if e.is_protagonist)
    assert hero.name == "林川" and hero.key == plan.protagonist_key
    links = {(lk.src, lk.rel, lk.dst) for lk in plan.links}
    assert (entity_key("item", "信"), REL_HELD_BY, plan.protagonist_key) in links
    assert (plan.protagonist_key, REL_LOCATED_IN, entity_key("location", "酒馆")) in links
    assert (
        entity_key("character", "老周"),
        REL_LOCATED_IN,
        entity_key("location", "酒馆"),
    ) in links
    assert plan.scene_location == entity_key("location", "酒馆")
    assert plan.scene_present == [entity_key("character", "老周")]
    fact = plan.facts[0]
    assert fact.secret and fact.known_by == (entity_key("character", "老周"),)
    # 所有关系两端都是计划里的实体
    keys = {e.key for e in plan.entities}
    assert all(lk.src in keys and lk.dst in keys for lk in plan.links)


def test_minimal_seed_uses_card_text_only() -> None:
    card = CharacterCard(
        spec="card_v2",
        name="阿苓",
        description="{{char}} 是帮工。\n\n" + "很长的描述。" * 200,
        personality="机灵",
        scenario="雨夜，{{user}} 走进酒馆。",
        first_mes="*抬头* 外乡人？",
    )
    seed = minimal_seed(card, protagonist_name="林川", protagonist_summary="信使")
    assert seed.protagonist.name == "林川" and seed.protagonist.summary == "信使"
    assert [c.name for c in seed.characters] == ["阿苓"]
    assert seed.characters[0].summary.startswith("阿苓 是帮工")
    assert len(seed.characters[0].summary) <= 500
    assert seed.world.setting == "雨夜，林川 走进酒馆。"
    assert seed.opening.present == ["阿苓"]
    assert "{{" not in seed.model_dump_json()


def test_names_normalize_width_case_and_spaces() -> None:
    assert normalize_name(" Ａｂｃ　老·周 ") == normalize_name("abc老周")


def test_resolve_action() -> None:
    options = [TurnOption("o1", "走向柜台"), TurnOption("o2", "坐下")]
    picked = resolve_action("option", text="伪造的文字", option_id="o2", parent_options=options)
    assert picked == PlayerAction(source="option", text="坐下", option_id="o2")
    typed = resolve_action("text", text="  我推门  ", option_id=None, parent_options=options)
    assert typed.text == "我推门"
    # 结局的方向可以不填
    ending = resolve_action("ending", text="  和阿苓离开  ", option_id=None, parent_options=[])
    assert ending == PlayerAction(source="ending", text="和阿苓离开")
    blank = resolve_action("ending", text=None, option_id=None, parent_options=[])
    assert blank == PlayerAction(source="ending", text="")
    for source, text, option_id, code in [
        ("option", None, "o9", "OPTION_NOT_FOUND"),
        ("option", None, None, "VALIDATION_ERROR"),
        ("text", "   ", None, "VALIDATION_ERROR"),
        ("text", "字" * 2001, None, "VALIDATION_ERROR"),
        ("ending", "字" * 2001, None, "VALIDATION_ERROR"),
        ("magic", "x", None, "VALIDATION_ERROR"),
    ]:
        with pytest.raises(ActionError) as info:
            resolve_action(source, text=text, option_id=option_id, parent_options=options)
        assert info.value.code == code


def test_clip_middle_keeps_head_and_tail() -> None:
    assert clip_middle("短", 10) == "短"
    clipped = clip_middle("开头" + "中" * 100 + "结尾", 12)
    assert len(clipped) == 12 and clipped.startswith("开头") and clipped.endswith("结尾")
