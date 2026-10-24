"""开局时卡的原文快照：宏换成名字、停用的世界书条目不要、超出上限时按固定顺序截短。"""

from __future__ import annotations

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry
from bettertavern.domain.world.card_source import snapshot_cards

LEAD = CharacterCard(
    spec="card_v2",
    name="阿苓",
    description="{{char}} 是酒馆帮工，认识 {{user}}。",
    personality="嘴硬心软",
    scenario="雨夜，{{user}} 推门进来。",
    mes_example="{{char}}：地图？我可没有。",
    book=(
        LoreEntry(name="火漆", keys=("火漆",), content="商会的火漆是黑色的", constant=True),
        LoreEntry(keys=("渡口",), content="渡口子时才有船"),
        LoreEntry(keys=("停用",), content="不要这一条", enabled=False),
        LoreEntry(keys=("空的",), content="   "),
    ),
)
OTHER = CharacterCard(
    spec="card_v2",
    name="老周",
    description="掌柜",
    mes_example="老周：要喝就快点。",
    book=(LoreEntry(keys=("账",), content="老周欠商会的钱"),),
)


def test_the_snapshot_keeps_every_card_with_the_names_filled_in() -> None:
    source = snapshot_cards([LEAD, OTHER], protagonist_name="林川")
    assert not source.truncated
    lead, other = source.cards
    assert lead.description == "阿苓 是酒馆帮工，认识 林川。"
    assert lead.scenario == "雨夜，林川 推门进来。" and lead.examples == "阿苓：地图？我可没有。"
    # 停用的、没有内容的条目不要
    assert [(e.name, e.content, e.constant) for e in lead.lore] == [
        ("火漆", "商会的火漆是黑色的", True),
        ("", "渡口子时才有船", False),
    ]
    assert other.name == "老周" and other.lore[0].content == "老周欠商会的钱"


def test_over_the_limit_drops_lore_then_examples_then_constant_lore() -> None:
    full = snapshot_cards([LEAD, OTHER], protagonist_name="林川")
    # 刚好超出不常驻的两条：只去掉它们，从最后一张卡往前
    tight = snapshot_cards(
        [LEAD, OTHER], protagonist_name="林川", limit=full.chars() - len("老周欠商会的钱")
    )
    assert tight.truncated
    assert tight.cards[1].lore == ()
    assert [e.content for e in tight.cards[0].lore] == ["商会的火漆是黑色的", "渡口子时才有船"]
    # 再少：不常驻的都去掉以后截短对话示例，常驻条目还在
    no_loose = full.chars() - len("老周欠商会的钱") - len("渡口子时才有船")
    shorter = snapshot_cards([LEAD, OTHER], protagonist_name="林川", limit=no_loose - 3)
    assert [e.content for e in shorter.cards[0].lore] == ["商会的火漆是黑色的"]
    assert shorter.cards[1].examples == "老周：要喝就"
    assert shorter.cards[0].examples == "阿苓：地图？我可没有。"
    assert shorter.chars() <= no_loose - 3


def test_the_descriptions_go_last() -> None:
    # 只放得下描述：世界书、对话示例、场景、性格都去掉了，描述从最后一张卡往前截
    descriptions = len("阿苓 是酒馆帮工，认识 林川。") + len("掌柜")
    source = snapshot_cards([LEAD, OTHER], protagonist_name="林川", limit=descriptions)
    lead, other = source.cards
    assert lead.lore == () and other.lore == ()
    assert lead.examples == "" and lead.scenario == "" and lead.personality == ""
    assert lead.description == "阿苓 是酒馆帮工，认识 林川。" and other.description == "掌柜"
    tiny = snapshot_cards([LEAD, OTHER], protagonist_name="林川", limit=5)
    assert tiny.chars() <= 5 and tiny.cards[1].description == ""
