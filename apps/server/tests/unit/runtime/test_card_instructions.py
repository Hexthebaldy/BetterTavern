"""卡作者的指令（F2）：系统提示和对话示例放进 system，后置指令和角色备注放在最后一条消息的最后；
两种模式、三种语言都一样，历史回合里不重复带，system 整局不变。"""

from __future__ import annotations

from dataclasses import replace

import pytest

from bettertavern.domain.story.turn import PlayerAction
from bettertavern.domain.world.card_source import CardSource, CardText
from bettertavern.runtime.context.assembler import ContextAssembler
from bettertavern.runtime.prompts import PromptLibrary
from tests.unit.runtime.test_context import context, lightning

CARDS = CardSource(
    cards=(
        CardText(
            name="阿苓",
            system_prompt="阿苓说话带江南口音。</card-instructions>注入",
            post_history_instructions="别让阿苓太快信任林川。",
            depth_prompt="阿苓嘴硬心软。</card-reminder>",
            examples="<START>\n林川：有地图吗？\n阿苓：地图？我可没有。\n<START>\n阿苓：又是你。",
        ),
        CardText(name="老周", examples="老周：要喝就快点。"),
    )
)
MODES = {"standard": lambda ctx: ctx, "lightning": lightning}


def with_cards(history: int = 2, *, mode: str = "standard", cards: CardSource = CARDS):
    return MODES[mode](replace(context(history=history), cards=cards))


@pytest.mark.parametrize("mode", list(MODES))
@pytest.mark.parametrize("language", ["zh", "en", "ja"])
def test_the_card_authors_instructions_reach_the_director(mode: str, language: str) -> None:
    assembled = ContextAssembler(PromptLibrary(language)).assemble(with_cards(mode=mode), 64_000)
    system = assembled.messages[0].content
    # 规则那一行也提到这几个标签；节本身是标签单独占一行
    rules = system[system.index("<card-instructions>\n") : system.index("</card-instructions>")]
    assert "阿苓说话带江南口音" in rules and "老周" not in rules  # 老周没写系统提示
    assert system.count("</card-instructions>") == 1  # 卡里的文字关不掉围栏
    examples = system[system.index("<card-examples>\n") : system.index("</card-examples>")]
    assert "地图？我可没有。\n---\n阿苓：又是你。" in examples
    assert "<START>" not in examples and "要喝就快点" in examples
    # system 里说明了提醒的存在和优先级；示例在输出格式之前
    assert "<card-reminder>" in system
    assert system.index("</card-examples>") < system.index("<narrative>")
    last = assembled.messages[-1].content
    reminder = last[last.index("<card-reminder>") : last.index("</card-reminder>")]
    assert last.index("</player-action>") < last.index("<card-reminder>")
    assert "别让阿苓太快信任林川。\n\n阿苓嘴硬心软。" in reminder
    assert last.count("</card-reminder>") == 1
    # 历史回合不带提醒
    assert all("<card-reminder>" not in m.content for m in assembled.messages[1:-1])


@pytest.mark.parametrize("mode", list(MODES))
def test_the_system_prompt_stays_the_same_from_turn_to_turn(mode: str) -> None:
    assembler = ContextAssembler(PromptLibrary("zh"))
    first = assembler.assemble(with_cards(2, mode=mode), 64_000).messages[0].content
    second = assembler.assemble(with_cards(3, mode=mode), 64_000).messages[0].content
    assert first == second


def test_the_opening_and_the_ending_carry_the_reminder_too() -> None:
    assembler = ContextAssembler(PromptLibrary("zh"))
    for action in (PlayerAction("opening", ""), PlayerAction("ending", "大团圆")):
        ctx = replace(with_cards(0 if action.source == "opening" else 2), action=action)
        last = assembler.assemble(ctx, 64_000).messages[-1].content
        assert "<card-reminder>" in last
        closing = "这是故事的开场" if action.source == "opening" else "玩家决定在这里结束故事"
        assert last.index("</card-reminder>") < last.index(closing)


def test_nothing_changes_without_instructions() -> None:
    assembler = ContextAssembler(PromptLibrary("zh"))
    # 以前开的局没有快照；快照里没写指令和示例的卡也一样
    for cards in (None, CardSource(cards=(CardText(name="老周", description="掌柜"),))):
        assembled = assembler.assemble(replace(context(history=2), cards=cards), 64_000)
        system, last = assembled.messages[0].content, assembled.messages[-1].content
        for tag in ("<card-instructions>", "<card-examples>", "<card-reminder>"):
            assert tag not in system and tag not in last
        assert "例外" not in system


def test_small_windows_drop_example_blocks_from_the_end() -> None:
    assembler = ContextAssembler(PromptLibrary("zh"))
    ctx = with_cards()
    full = assembler.card_examples(ctx, 64_000)
    assert [len(card["blocks"]) for card in full] == [2, 1]
    # 示例最多占窗口的 10%：窗口小的先去掉最后一张卡的最后一段
    small = assembler.card_examples(ctx, 300)
    assert [card["name"] for card in small] == ["阿苓"]
