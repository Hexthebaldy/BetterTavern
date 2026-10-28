"""开局时卡的原文快照：宏换成名字、停用的世界书条目不要、卡作者的指令去重，
各部分超出上限时按固定顺序截短。"""

from __future__ import annotations

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry
from bettertavern.domain.world.card_source import (
    INSTRUCTION_CHARS,
    example_blocks,
    fit_examples,
    snapshot_cards,
)

LEAD = CharacterCard(
    spec="card_v2",
    name="阿苓",
    description="{{char}} 是酒馆帮工，认识 {{user}}。",
    personality="嘴硬心软",
    scenario="雨夜，{{user}} 推门进来。",
    mes_example="{{char}}：地图？我可没有。",
    system_prompt="{{original}}\n{{char}} 说话带江南口音。不许替 {{user}} 说话。",
    post_history_instructions="别让 {{char}} 太快信任 {{user}}。",
    depth_prompt="{{char}} 嘴硬心软。",
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
    system_prompt="不许替 林川 说话。",
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
    # 卡作者的指令：{{original}} 去掉（我们的规则一直都在）
    assert lead.system_prompt == "阿苓 说话带江南口音。不许替 林川 说话。"
    assert lead.reminder() == "别让 阿苓 太快信任 林川。\n\n阿苓 嘴硬心软。"
    assert other.system_prompt == "不许替 林川 说话。" and other.reminder() == ""


def test_identical_instructions_are_kept_once() -> None:
    twin = OTHER.model_copy(update={"name": "小周", "system_prompt": "不许替 {{user}} 说话。"})
    source = snapshot_cards([OTHER, twin], protagonist_name="林川")
    # 换完名字以后一字不差：只留第一张卡的
    assert [c.system_prompt for c in source.cards] == ["不许替 林川 说话。", ""]
    # 用了 {{char}} 的，换完名字就不一样了，都留着
    voiced = [
        OTHER.model_copy(update={"system_prompt": "{{char}} 说话很冲"}),
        twin.model_copy(update={"system_prompt": "{{char}} 说话很冲"}),
    ]
    source = snapshot_cards(voiced, protagonist_name="林川")
    assert [c.system_prompt for c in source.cards] == ["老周 说话很冲", "小周 说话很冲"]


def test_the_instructions_have_their_own_limits() -> None:
    def card(name: str, **texts: str) -> CharacterCard:
        return CharacterCard(spec="card_v2", name=name).model_copy(update=texts)

    # 系统提示：每张卡最多 3000 字，合计最多 6000 字，从最后一张卡往前截
    cards = [
        card("甲", system_prompt="甲" * 4000),
        card("乙", system_prompt="乙" * 2500),
        card("丙", system_prompt="丙" * 2500),
    ]
    source = snapshot_cards(cards, protagonist_name="林川")
    assert source.truncated
    assert [len(c.system_prompt) for c in source.cards] == [INSTRUCTION_CHARS, 2500, 500]
    # 后置指令和角色备注合计最多 1500 字：先截最后一张卡的角色备注
    reminder = snapshot_cards(
        [card("甲", post_history_instructions="后" * 1000, depth_prompt="备" * 1000)],
        protagonist_name="林川",
    )
    only = reminder.cards[0]
    assert len(only.post_history_instructions) == 1000 and len(only.depth_prompt) == 500
    # 对话示例按段去掉：从最后一张卡的最后一段往前
    examples = snapshot_cards(
        [
            card("甲", mes_example="<START>\n" + "甲" * 3000 + "\n<START>\n" + "乙" * 2000),
            card("乙", mes_example="<START>\n" + "丙" * 2000),
        ],
        protagonist_name="林川",
    )
    assert [example_blocks(c.examples) for c in examples.cards] == [
        ["甲" * 3000, "乙" * 2000],
        [],
    ]


def test_over_the_limit_drops_lore_then_constant_lore() -> None:
    full = snapshot_cards([LEAD, OTHER], protagonist_name="林川")
    source = sum(c.source_chars() for c in full.cards)
    # 刚好超出不常驻的一条：只去掉它，从最后一张卡往前
    tight = snapshot_cards(
        [LEAD, OTHER], protagonist_name="林川", limit=source - len("老周欠商会的钱")
    )
    assert tight.truncated
    assert tight.cards[1].lore == ()
    assert [e.content for e in tight.cards[0].lore] == ["商会的火漆是黑色的", "渡口子时才有船"]
    # 再少：不常驻的都去掉以后去掉常驻条目；对话示例和指令不受影响
    no_loose = source - len("老周欠商会的钱") - len("渡口子时才有船")
    shorter = snapshot_cards([LEAD, OTHER], protagonist_name="林川", limit=no_loose - 3)
    assert shorter.cards[0].lore == ()
    assert shorter.cards[0].scenario == "雨夜，林川 推门进来。"
    assert shorter.cards[1].examples == "老周：要喝就快点。"
    assert shorter.cards[0].system_prompt == full.cards[0].system_prompt


def test_the_descriptions_go_last() -> None:
    # 只放得下描述：世界书、场景、性格都去掉了，描述从最后一张卡往前截
    descriptions = len("阿苓 是酒馆帮工，认识 林川。") + len("掌柜")
    source = snapshot_cards([LEAD, OTHER], protagonist_name="林川", limit=descriptions)
    lead, other = source.cards
    assert lead.lore == () and other.lore == ()
    assert lead.scenario == "" and lead.personality == ""
    assert lead.description == "阿苓 是酒馆帮工，认识 林川。" and other.description == "掌柜"
    assert lead.examples == "阿苓：地图？我可没有。"
    tiny = snapshot_cards([LEAD, OTHER], protagonist_name="林川", limit=5)
    assert sum(c.source_chars() for c in tiny.cards) <= 5 and tiny.cards[1].description == ""


def test_example_blocks_and_fitting() -> None:
    assert example_blocks("<START>\n甲\n<start>\n\n<START>乙") == ["甲", "乙"]
    assert example_blocks("没有分段的示例") == ["没有分段的示例"]
    groups = [["a" * 10, "b" * 10], ["c" * 10]]
    assert fit_examples(groups, limit=30) == ([["a" * 10, "b" * 10], ["c" * 10]], False)
    assert fit_examples(groups, limit=25) == ([["a" * 10, "b" * 10], []], True)
    # 只剩一段还超：截短它
    assert fit_examples(groups, limit=4) == ([["a" * 4], []], True)
    # 按别的方式算长短（例如估算的 token）
    assert fit_examples(groups, limit=2, size=lambda text: len(text) // 10) == (
        [["a" * 10, "b" * 10], []],
        True,
    )
