"""多角色的局（docs/cast.md）：谁说话的规则、几段怎么拼成叙述、行动里的点名和“让他们接着说”。"""

from __future__ import annotations

import pytest

from bettertavern.domain.story.cast import (
    CastMember,
    Segment,
    choose_speakers,
    join_notes,
    join_segments,
    segments_from_json,
    strip_header,
)
from bettertavern.domain.story.turn import ActionError, PlayerAction, TurnOption, resolve_action

CAST = (CastMember(0, "阿苓"), CastMember(1, "老周"), CastMember(2, "温九"))


def test_picked_speakers_come_first_in_the_order_they_were_picked() -> None:
    assert choose_speakers(CAST, picked=[2, None, 0, 2], action_text="我问老周") == [2, None, 0]


def test_muted_characters_are_never_picked() -> None:
    cast = (CastMember(0, "阿苓"), CastMember(1, "老周", muted=True), CastMember(2, "温九"))
    # 点名点了先不出场的人不算，接着看行动里提到了谁
    assert choose_speakers(cast, picked=[1], action_text="我问老周和温九") == [2]
    assert choose_speakers(cast, action_text="老周？") == [0]


def test_names_in_the_action_speak_in_the_order_they_appear() -> None:
    assert choose_speakers(CAST, action_text="我先看温九，再问阿苓地图的事") == [2, 0]
    # 世界状态里认得的别名也算
    assert choose_speakers(CAST, action_text="掌柜，来壶酒", aliases={1: ("掌柜",)}) == [1]


def test_otherwise_the_quietest_character_present_speaks() -> None:
    spoken = {0: 5, 1: 3, 2: 7}
    assert choose_speakers(CAST, action_text="我坐下", last_spoken=spoken) == [1]
    # 只看在场的；从没说过话的最先
    assert choose_speakers(CAST, present={0, 2}, last_spoken=spoken) == [0]
    assert choose_speakers(CAST, present={0, 2}, last_spoken={0: 5}) == [2]


def test_the_narrator_writes_when_no_character_is_present() -> None:
    assert choose_speakers(CAST, action_text="我独自走进雨里", present=set()) == [None]
    muted = tuple(CastMember(m.position, m.name, muted=True) for m in CAST)
    assert choose_speakers(muted, action_text="大家好") == [None]


def test_continuing_skips_whoever_spoke_last() -> None:
    spoken = {0: 5, 1: 5, 2: 5}
    picked = choose_speakers(CAST, continuing=True, previous=[1, 0], last_spoken=spoken)
    assert picked == [1]
    # 只剩他一个在场时还是他
    assert choose_speakers(CAST, continuing=True, previous=[0], present={0}) == [0]


def test_segments_join_with_a_name_line_and_drop_a_copied_header() -> None:
    segments = [Segment(0, "外乡人？", notes="她认得那封信"), Segment(None, "雨更大了。")]
    text = join_segments(segments, CAST, header="【{name}】", narrator="旁白")
    assert text == "【阿苓】\n外乡人？\n\n【旁白】\n雨更大了。"
    assert join_notes(segments, CAST, narrator="旁白") == "阿苓: 她认得那封信"
    assert segments_from_json([s.to_json() for s in segments]) == (
        Segment(0, "外乡人？"),
        Segment(None, "雨更大了。"),
    )
    names = ["阿苓", "老周", "旁白"]
    assert strip_header("【 阿苓 】\n\n她放下杯子。", names, "【{name}】") == "她放下杯子。"
    assert strip_header("【阿苓】她放下杯子。", names, "【{name}】") == "【阿苓】她放下杯子。"
    assert strip_header("她放下杯子。\n【阿苓】", names, "【{name}】") == "她放下杯子。\n【阿苓】"


def test_only_stories_with_a_cast_can_pick_speakers_or_let_them_continue() -> None:
    action = resolve_action(
        "text", text="你好", option_id=None, parent_options=[], speakers=[1, None], cast=CAST
    )
    assert action == PlayerAction("text", "你好", speakers=(1, None))
    assert PlayerAction.from_json(action.to_json()) == action
    options = [TurnOption("o1", "走"), TurnOption("o2", "留")]
    picked = resolve_action(
        "option", text=None, option_id="o2", parent_options=options, speakers=[0], cast=CAST
    )
    assert picked.text == "留" and picked.speakers == (0,)
    quiet = resolve_action("continue", text="忽略", option_id=None, parent_options=[], cast=CAST)
    assert quiet == PlayerAction("continue", "")
    with pytest.raises(ActionError):
        resolve_action("continue", text=None, option_id=None, parent_options=[])
    with pytest.raises(ActionError):
        resolve_action("text", text="你好", option_id=None, parent_options=[], speakers=[0])
    with pytest.raises(ActionError):
        resolve_action(
            "text", text="你好", option_id=None, parent_options=[], speakers=[5], cast=CAST
        )
    with pytest.raises(ActionError):
        resolve_action(
            "ending", text="", option_id=None, parent_options=[], speakers=[0], cast=CAST
        )
