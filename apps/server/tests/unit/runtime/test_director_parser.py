from __future__ import annotations

import random

import pytest

from bettertavern.runtime.protocol.director_parser import (
    DirectorParse,
    DirectorStreamParser,
    ParseStage,
    parse_director_text,
)

GOOD = (
    "<narrative>\n我推开酒馆的门，潮湿的木头味扑面而来……\n掌柜抬头看了我一眼。\n</narrative>\n"
    "<options>\n1. 走向柜台，向老板打听昨晚的事\n2. 在角落坐下，留意那个戴兜帽的人\n</options>"
)
NARRATIVE = "我推开酒馆的门，潮湿的木头味扑面而来……\n掌柜抬头看了我一眼。"
OPTIONS = ("走向柜台，向老板打听昨晚的事", "在角落坐下，留意那个戴兜帽的人")


def stream(text: str, sizes: list[int]) -> tuple[list[str], DirectorParse]:
    parser = DirectorStreamParser()
    deltas: list[str] = []
    position = 0
    for size in sizes:
        deltas += parser.feed(text[position : position + size])
        position += size
    deltas += parser.feed(text[position:])
    tail, result = parser.finish()
    return deltas + tail, result


def test_compliant_output() -> None:
    result = parse_director_text(GOOD)
    assert result.stage is ParseStage.OK
    assert result.narrative == NARRATIVE
    assert result.options == OPTIONS
    assert result.repairs == () and result.notes == ()
    assert not result.needs_options_repair


@pytest.mark.parametrize("seed", range(40))
def test_any_chunking_gives_same_result_and_deltas_join_to_narrative(seed: int) -> None:
    rng = random.Random(seed)
    text = rng.choice(
        [
            GOOD,
            "<think>先想想剧情</think>" + GOOD,
            "好的。\n" + GOOD + "\n（完）",
            GOOD.replace("<narrative>", "<NARRATIVE>").replace("</options>", "</Options>"),
            GOOD.replace(
                "</narrative>\n<options>", "</narrative>\n<think>选项要短</think><options>"
            ),
        ]
    )
    sizes = [rng.randint(1, 7) for _ in range(len(text) // 3)]
    deltas, result = stream(text, sizes)
    assert result.narrative == NARRATIVE
    assert result.options == OPTIONS
    assert "".join(deltas) == result.narrative
    assert all(delta for delta in deltas)
    assert "<" not in "".join(deltas)


def test_tag_split_one_char_at_a_time_never_leaks() -> None:
    deltas, result = stream(GOOD, [1] * len(GOOD))
    assert "".join(deltas) == NARRATIVE
    assert result.stage is ParseStage.OK


def test_think_block_containing_tags_is_ignored() -> None:
    text = "<think>我打算写 <narrative> 标签……</think>" + GOOD
    result = parse_director_text(text)
    assert result.narrative == NARRATIVE
    assert result.stage is ParseStage.OK


def test_extra_text_outside_tags_is_noted_but_still_ok() -> None:
    result = parse_director_text("好的，这是故事：\n" + GOOD + "\n希望你喜欢")
    assert result.stage is ParseStage.OK
    assert len(result.notes) == 2


def test_more_than_two_options_takes_first_two() -> None:
    text = GOOD.replace("</options>", "3. 转身离开\n</options>")
    result = parse_director_text(text)
    assert result.options == OPTIONS
    assert result.stage is ParseStage.OK


def test_narrative_not_closed_before_options() -> None:
    text = GOOD.replace("</narrative>\n", "")
    result = parse_director_text(text)
    assert result.narrative == NARRATIVE
    assert result.options == OPTIONS
    assert result.stage is ParseStage.SALVAGED


def test_stream_ends_inside_narrative() -> None:
    text = "<narrative>\n我推开门，屋里一片漆黑。"
    deltas, result = stream(text, [5, 5, 5])
    assert result.narrative == "我推开门，屋里一片漆黑。"
    assert "".join(deltas) == result.narrative
    assert result.needs_options_repair
    assert result.stage is ParseStage.SALVAGED


def test_options_inside_unclosed_narrative_are_split_out() -> None:
    text = "<narrative>\n我推开门。\n\n1. 进去看看\n2. 先敲门"
    deltas, result = stream(text, [3] * 10)
    assert result.narrative == "我推开门。"
    assert result.options == ("进去看看", "先敲门")
    assert result.rewritten  # 流式推出去的文字里含选项，客户端应以最终叙述为准
    assert "".join(deltas) != result.narrative


def test_missing_options_tag_uses_numbered_lines_after_narrative() -> None:
    text = "<narrative>我推开门。</narrative>\n1. 进去看看\n2. 先敲门\n"
    result = parse_director_text(text)
    assert result.options == ("进去看看", "先敲门")
    assert result.stage is ParseStage.SALVAGED


def test_missing_narrative_tag_salvages_whole_text() -> None:
    text = "我推开门。屋里很暗。\n\n1. 进去看看\n2. 先敲门"
    deltas, result = stream(text, [4] * 5)
    assert result.narrative == "我推开门。屋里很暗。"
    assert result.options == ("进去看看", "先敲门")
    assert "".join(deltas) == result.narrative  # 抢救出的叙述在 finish() 时一次推出
    assert result.stage is ParseStage.SALVAGED


def test_options_tag_without_narrative_tag() -> None:
    text = "我推开门。\n<options>\n1. 进去\n2. 离开\n</options>"
    result = parse_director_text(text)
    assert result.narrative == "我推开门。"
    assert result.options == ("进去", "离开")


def test_unnumbered_options_inside_tag() -> None:
    text = "<narrative>我推开门。</narrative><options>\n- 进去\n- 离开\n</options>"
    result = parse_director_text(text)
    assert result.options == ("进去", "离开")
    assert result.stage is ParseStage.SALVAGED


def test_full_width_numbers_and_separators() -> None:
    text = "<narrative>门开了。</narrative><options>\n１、进去\n２）离开\n</options>"
    result = parse_director_text(text)
    assert result.options == ("进去", "离开")


def test_duplicate_options_count_once() -> None:
    text = "<narrative>门开了。</narrative><options>\n1. 进去\n2. 进去\n</options>"
    result = parse_director_text(text)
    assert result.options == ("进去",)
    assert result.needs_options_repair


def test_empty_output_fails() -> None:
    assert parse_director_text("").stage is ParseStage.FAILED
    assert parse_director_text("<think>只想了想</think>").stage is ParseStage.FAILED
    assert parse_director_text("<narrative>  </narrative><options>1. a\n2. b</options>").stage is (
        ParseStage.FAILED
    )


def test_feed_after_finish_raises() -> None:
    parser = DirectorStreamParser()
    parser.finish()
    with pytest.raises(RuntimeError):
        parser.feed("x")


NOTES = "<director-notes>\n伏笔：信封上的火漆是假的。\n</director-notes>"


@pytest.mark.parametrize("seed", range(20))
def test_director_notes_are_kept_apart_from_the_narrative(seed: int) -> None:
    rng = random.Random(seed)
    text = GOOD + "\n" + NOTES
    sizes = [rng.randint(1, 7) for _ in range(len(text) // 3)]
    deltas, result = stream(text, sizes)
    assert "".join(deltas) == NARRATIVE  # 推给玩家的只有叙述
    assert result.stage is ParseStage.OK and result.options == OPTIONS
    assert result.director_notes == "伏笔：信封上的火漆是假的。"
    assert result.notes == ()  # 备注不算标签外的多余文字


def test_notes_never_leak_into_the_narrative() -> None:
    # 叙述没闭合就写备注：叙述到此为止，备注照样单独拿出来，选项还能接着解析
    text = (
        "<narrative>\n我推开门。\n<director-notes>老周在说谎</director-notes>\n"
        "<options>\n1. 追问\n2. 离开\n</options>"
    )
    deltas, result = stream(text, [3] * 30)
    assert "".join(deltas) == "我推开门。" == result.narrative
    assert result.director_notes == "老周在说谎"
    assert result.options == ("追问", "离开")
    assert result.stage is ParseStage.SALVAGED


def test_ending_may_carry_notes_without_options() -> None:
    result = parse_director_text("<narrative>\n故事结束了。\n</narrative>\n" + NOTES)
    assert result.narrative == "故事结束了。" and result.options == ()
    assert result.director_notes.startswith("伏笔")


def test_unclosed_notes_are_still_kept_and_clipped() -> None:
    result = parse_director_text(GOOD + "<director-notes>" + "备" * 2000)
    assert result.stage is ParseStage.OK
    assert len(result.director_notes) == 600
    assert "<director-notes> was not closed" in result.notes


def test_a_tool_call_written_as_text_is_not_salvaged_as_narrative() -> None:
    # DeepSeek 偶尔把工具调用写成正文（真实试玩里见过），不能当叙述推给玩家
    text = (
        "<recall>\n<query>货栈 看守 老人</query>\n</recall>\n"
        "</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>"
    )
    deltas, result = stream(text, [4] * 40)
    assert deltas == [] and result.narrative == ""
    assert result.stage is ParseStage.FAILED
    assert "tool call written as text" in result.repairs
