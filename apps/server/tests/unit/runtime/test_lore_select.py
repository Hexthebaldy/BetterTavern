"""每回合挑世界书条目（docs/lorebook.md 第 7 节）：规则照 SillyTavern 新装默认设置
（public/scripts/world-info.js 的 checkWorldInfo），每条规则对着 ST 的行为写几例。"""

from __future__ import annotations

import itertools

import pytest

from bettertavern.domain.scenario.card import LoreEntry, LoreRules
from bettertavern.domain.world.lore import CardTexts, LoreItem, LoreSnapshot
from bettertavern.runtime.context import lore as lore_module
from bettertavern.runtime.context.lore import (
    LoreScan,
    LoreSelection,
    constant_items,
    lore_budget,
    select_lore,
)
from bettertavern.runtime.context.lore_effects import LoreTimers

WINDOW = 100_000  # 预算 min(25000, 12000) = 12000 token


def snap(*entries: LoreEntry) -> LoreSnapshot:
    items = tuple(LoreItem(entry=e, source="book", source_name="书") for e in entries)
    return LoreSnapshot(items=items, user_name="林川", char_name="沈知微")


def entry(content: str, *keys: str, **fields: object) -> LoreEntry:
    return LoreEntry(content=content, keys=keys, **fields)  # type: ignore[arg-type]


def picked(snapshot: LoreSnapshot, *messages: str, window: int = WINDOW) -> list[str]:
    selection = select_lore(snapshot, LoreScan(messages=messages), window=window)
    return [i.entry.content for i in selection.triggered]


def test_budget_is_a_quarter_of_the_window_capped() -> None:
    assert lore_budget(16_000) == 4000
    assert lore_budget(1_000_000) == 12_000


def test_names_are_part_of_the_scanned_text() -> None:
    # 扫描的消息前面带说话人的名字：关键词是角色名的条目每回合都会触发
    book = snap(entry("掌柜的来历", "沈知微"))
    assert picked(book, "林川: 我坐下", "沈知微: 雨还在下") == ["掌柜的来历"]
    assert picked(book, "我坐下", "雨还在下") == []


def test_only_the_last_two_messages_are_scanned() -> None:
    book = snap(entry("渡口", "渡口"))
    assert picked(book, "林川: 走", "沈知微: 雨", "林川: 去渡口") == []
    assert picked(book, "林川: 去渡口", "沈知微: 雨") == ["渡口"]


@pytest.mark.parametrize(
    ("key", "text", "hit"),
    [
        ("art", "we start now", False),  # 整词：英文不会命中词的一部分
        ("art", "an art show", True),
        ("Art", "AN ART SHOW", True),  # 不区分大小写
        ("dark forest", "the darkforest", False),
        ("dark forest", "into the dark forest", True),  # 有空格的关键词按包含找
        ("渡口", "我走向渡口边", True),  # 中文前后都不是英文字母数字，实际按包含找
        ("ABC", "ＡＢＣ公司", True),  # 全角字母当半角
        ("a_b", "xa_b", False),  # 下划线也算词的一部分
    ],
)
def test_whole_word_matching(key: str, text: str, hit: bool) -> None:
    assert picked(snap(entry("命中", key)), text) == (["命中"] if hit else [])


def test_whole_words_and_case_can_be_turned_off_per_entry() -> None:
    loose = entry("命中", "art", rules=LoreRules(whole_words=False))
    assert picked(snap(loose), "we start now") == ["命中"]
    strict = entry("命中", "Art", rules=LoreRules(case_sensitive=True))
    assert picked(snap(strict), "an art show") == []
    assert picked(snap(strict), "an Art show") == ["命中"]


def test_regex_keys() -> None:
    book = snap(
        entry("老周", "/老周|周叔/"), entry("英文", "/^shen\\b/i"), entry("坏的", "/(老周/")
    )
    assert picked(book, "林川: 我去找周叔") == ["老周"]
    # 正则按原文匹配（带名字），开关照 JS 的写法
    assert picked(book, "Shen: hi") == ["英文"]


def test_runaway_regex_is_cut_off() -> None:
    book = snap(entry("慢", "/(a|aa)+$/"), entry("快", "渡口"))
    selection = select_lore(book, LoreScan(messages=("a" * 40 + "! 渡口",)), window=WINDOW)
    assert [i.entry.content for i in selection.triggered] == ["快"]
    assert selection.stats["regex_timeouts"] >= 1


@pytest.mark.parametrize(
    ("logic", "text", "hit"),
    [
        ("any", "老周 欠债", True),
        ("any", "老周", False),
        ("all", "老周 欠债 商会", True),
        ("all", "老周 欠债", False),
        ("not_any", "老周", True),
        ("not_any", "老周 商会", False),
        ("not_all", "老周 欠债", True),
        ("not_all", "老周 欠债 商会", False),
    ],
)
def test_secondary_keys(logic: str, text: str, hit: bool) -> None:
    book = snap(entry("老周的债", "老周", secondary_keys=("欠债", "商会"), logic=logic))
    assert picked(book, text) == (["老周的债"] if hit else [])


def test_constants_go_to_the_system_prompt() -> None:
    book = snap(entry("背景", constant=True), entry("渡口", "渡口"))
    selection = select_lore(book, LoreScan(messages=("渡口",)), window=WINDOW)
    assert [i.entry.content for i in selection.constants] == ["背景"]
    assert [i.entry.content for i in selection.triggered] == ["渡口"]
    assert constant_items(book, WINDOW) == selection.constants


def test_recursion_until_nothing_new() -> None:
    book = snap(
        entry("王都住着国王", "王都"),
        entry("国王有个女儿叫阿九", "国王"),
        entry("阿九会骑马", "阿九"),
        entry("没人提", "海边"),
    )
    selection = select_lore(book, LoreScan(messages=("我进了王都",)), window=WINDOW)
    assert [i.entry.content for i in selection.triggered] == [
        "王都住着国王",
        "国王有个女儿叫阿九",
        "阿九会骑马",
    ]
    assert selection.stats["recursion"] == 2


def test_recursion_switches() -> None:
    stop = snap(
        entry("王都住着国王", "王都", rules=LoreRules(prevent_recursion=True)),
        entry("国王的事", "国王"),
    )
    assert picked(stop, "我进了王都") == ["王都住着国王"]
    only_direct = snap(
        entry("王都住着国王", "王都"),
        entry("国王的事", "国王", rules=LoreRules(exclude_recursion=True)),
    )
    assert picked(only_direct, "我进了王都") == ["王都住着国王"]
    assert picked(only_direct, "我进了王都，见到国王") == ["王都住着国王", "国王的事"]
    # 只在递归时触发（同 ST：第一层在开始时就算轮到了，有别的条目引起递归时才进；
    # 还有更高的层级没轮到时，没有新条目也会按下一层多扫一轮）
    delayed = entry("国王的事", "国王", rules=LoreRules(delay_until_recursion=1))
    assert picked(snap(delayed), "国王来了") == []
    assert picked(snap(delayed, entry("王都很大", "王都")), "国王来了王都") == [
        "国王的事",
        "王都很大",
    ]
    deeper = entry("更深的", "国王", rules=LoreRules(delay_until_recursion=2))
    assert picked(snap(delayed, deeper), "国王来了") == ["国王的事", "更深的"]


def test_budget_keeps_higher_priority_and_order_in_context_is_ascending(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(lore_module, "LORE_CAP", 25)
    book = snap(
        entry("甲" * 10, "门", priority=50),
        entry("乙" * 10, "门", priority=300),
        entry("丙" * 10, "门", priority=100),
    )
    selection = select_lore(book, LoreScan(messages=("门",)), window=WINDOW)
    # 预算 25：先装 300 的乙、再装 100 的丙（20），甲装不下；放进上下文时优先级小的在前
    assert [i.entry.content for i in selection.triggered] == ["丙" * 10, "乙" * 10]
    assert selection.stats["dropped"] == 1
    free = snap(
        entry("甲" * 10, "门", priority=50, rules=LoreRules(ignore_budget=True)),
        entry("乙" * 10, "门", priority=300),
        entry("丙" * 10, "门", priority=100),
    )
    assert len(picked(free, "门")) == 3


def test_entries_without_priority_use_their_list_position() -> None:
    book = snap(entry("后", "门", order=5), entry("前", "门", order=1))
    assert picked(book, "门") == ["前", "后"]


def test_same_input_same_output() -> None:
    book = snap(*(entry(f"第{i}条", f"词{i % 3}", priority=i % 5) for i in range(30)))
    scans = [LoreScan(messages=(f"词{a} 词{b}",)) for a, b in itertools.product(range(3), repeat=2)]
    for scan in scans:
        first = select_lore(book, scan, window=WINDOW)
        assert select_lore(book, scan, window=WINDOW) == first


def test_no_snapshot_or_empty_snapshot() -> None:
    assert select_lore(None, LoreScan(messages=("x",)), window=WINDOW).triggered == ()
    assert select_lore(snap(), LoreScan(messages=("x",)), window=WINDOW).constants == ()


# ---- 第 4 步：分组、概率、粘滞冷却延迟、扫描深度、顺带扫描、生成方式 ----------------------------


def run(
    snapshot: LoreSnapshot,
    *messages: str,
    turn: int = 1,
    seed: str = "pt:1:0",
    timers: LoreTimers | None = None,
) -> LoreSelection:
    scan = LoreScan(messages=messages, turn=turn, seed=seed, timers=timers or LoreTimers())
    return select_lore(snapshot, scan, window=WINDOW)


def names(selection: LoreSelection) -> list[str]:
    return [i.entry.content for i in selection.triggered]


def test_only_one_entry_per_group() -> None:
    weather = [entry(w, "天气", rules=LoreRules(groups=("天气",))) for w in ("晴", "雨", "雪")]
    picks = {names(run(snap(*weather), "看看天气", seed=f"pt:{n}:0"))[0] for n in range(40)}
    assert picks == {"晴", "雨", "雪"}  # 按权重抽，不同回合抽到不同的
    for n in range(10):
        assert len(names(run(snap(*weather), "看看天气", seed=f"pt:{n}:0"))) == 1
    # 同一回合（同一个种子）重试抽到的一样
    assert names(run(snap(*weather), "天气", seed="pt:7:0")) == names(
        run(snap(*weather), "天气", seed="pt:7:0")
    )


def test_group_weights_override_and_scoring() -> None:
    heavy = entry("常见", "天气", rules=LoreRules(groups=("g",), group_weight=1000))
    rare = entry("少见", "天气", rules=LoreRules(groups=("g",), group_weight=1))
    picks = [names(run(snap(heavy, rare), "天气", seed=f"s{n}"))[0] for n in range(50)]
    assert picks.count("常见") > 45
    # 组内优先：取优先级最大的
    favored = [
        entry("甲", "门", priority=10, rules=LoreRules(groups=("g",), group_override=True)),
        entry("乙", "门", priority=90, rules=LoreRules(groups=("g",), group_override=True)),
        entry("丙", "门", priority=500, rules=LoreRules(groups=("g",))),
    ]
    assert names(run(snap(*favored), "门")) == ["乙"]
    # 组打分：命中关键词多的留下
    scored = [
        entry("一个词", "门", rules=LoreRules(groups=("g",), group_scoring=True)),
        entry("两个词", "门", "窗", rules=LoreRules(groups=("g",), group_scoring=True)),
    ]
    assert names(run(snap(*scored), "门和窗")) == ["两个词"]


def test_a_group_already_used_this_turn_takes_no_more() -> None:
    first = entry("王都住着国王", "王都", rules=LoreRules(groups=("人物",)))
    second = entry("国王的事", "国王", rules=LoreRules(groups=("人物",)))
    # 第一轮进了“人物”组的一条，递归那一轮同组的不再进
    assert names(run(snap(first, second), "我进了王都")) == ["王都住着国王"]


def test_probability_is_a_fixed_roll_per_turn() -> None:
    maybe = snap(entry("偶尔", "门", rules=LoreRules(probability=30)))
    hits = sum(bool(names(run(maybe, "门", seed=f"pt:{n}:0"))) for n in range(400))
    assert 80 < hits < 160  # 大约三成
    assert names(run(maybe, "门", seed="pt:3:0")) == names(run(maybe, "门", seed="pt:3:0"))
    never = snap(entry("从不", "门", rules=LoreRules(probability=0)))
    assert not any(names(run(never, "门", seed=f"x{n}")) for n in range(50))


def test_sticky_keeps_an_entry_for_a_few_turns() -> None:
    book = snap(entry("老周在旁边", "老周", rules=LoreRules(sticky=2)))
    first = run(book, "林川: 找老周", turn=5)
    assert names(first) == ["老周在旁边"]
    assert first.record == {"hits": [0], "sticky": {"0": 7}, "cooldown": {}}
    timers = LoreTimers.from_json(first.record)
    for turn in (6, 7):  # 没人再提，也连着生效两回合
        later = run(book, "林川: 坐下", turn=turn, timers=timers)
        assert names(later) == ["老周在旁边"] and later.stats["sticky"] == [0]
        timers = LoreTimers.from_json(later.record)
    assert names(run(book, "林川: 坐下", turn=8, timers=timers)) == []


def test_cooldown_blocks_and_starts_after_sticky() -> None:
    cool = snap(entry("老周", "老周", rules=LoreRules(cooldown=2)))
    first = run(cool, "老周", turn=1)
    timers = LoreTimers.from_json(first.record)
    assert first.record["cooldown"] == {"0": 3}
    assert names(run(cool, "老周", turn=2, timers=timers)) == []
    assert names(run(cool, "老周", turn=3, timers=timers)) == []
    assert names(run(cool, "老周", turn=4, timers=timers)) == ["老周"]
    both = snap(entry("老周", "老周", rules=LoreRules(sticky=1, cooldown=2)))
    timers = LoreTimers.from_json(run(both, "老周", turn=1).record)
    sticky_turn = run(both, "无关", turn=2, timers=timers)
    assert names(sticky_turn) == ["老周"]  # 粘滞期里冷却不挡
    timers = LoreTimers.from_json(sticky_turn.record)
    assert sticky_turn.record["cooldown"] == {"0": 4}  # 粘滞结束后冷却两回合
    assert names(run(both, "老周", turn=3, timers=timers)) == []
    assert names(run(both, "老周", turn=5, timers=timers)) == ["老周"]


def test_delay_and_trigger_types() -> None:
    late = snap(entry("后来才有", "门", rules=LoreRules(delay=3)))
    assert names(run(late, "门", turn=2)) == []
    assert names(run(late, "门", turn=3)) == ["后来才有"]
    swipe_only = snap(entry("重新生成时", "门", rules=LoreRules(triggers=("swipe",))))
    assert names(run(swipe_only, "门")) == []
    normal = snap(entry("普通生成", "门", rules=LoreRules(triggers=("normal", "swipe"))))
    assert names(run(normal, "门")) == ["普通生成"]


def test_scan_depth_and_extra_sources() -> None:
    deep = snap(entry("记得渡口", "渡口", rules=LoreRules(scan_depth=4)))
    assert names(run(deep, "林川: 坐下", "沈知微: 嗯", "林川: 去渡口")) == ["记得渡口"]
    blind = snap(entry("看不见", "渡口", rules=LoreRules(scan_depth=0)))
    assert names(run(blind, "去渡口")) == []
    described = LoreSnapshot(
        items=(
            LoreItem(
                entry=entry("掌柜的规矩", "掌柜", rules=LoreRules(match=("description",))),
                source="card",
                source_name="沈知微",
            ),
            LoreItem(
                entry=entry("外乡人", "外乡", rules=LoreRules(match=("persona",))),
                source="book",
                source_name="书",
            ),
        ),
        persona="外乡来的信使",
        cards=(CardTexts(description="渡口茶馆的掌柜"),),
    )
    assert names(run(described, "林川: 坐下")) == ["掌柜的规矩", "外乡人"]


def test_changing_constants_leave_the_system_prompt() -> None:
    weather = [
        entry(w, constant=True, rules=LoreRules(groups=("天气",))) for w in ("晴", "雨", "雪")
    ]
    book = snap(entry("背景", constant=True), *weather)
    selection = run(book, "随便")
    assert [i.entry.content for i in selection.constants] == ["背景"]
    assert len(selection.triggered) == 1 and names(selection)[0] in ("晴", "雨", "雪")


def test_timers_survive_bad_records() -> None:
    assert LoreTimers.from_json(None) == LoreTimers()
    timers = LoreTimers.from_json({"sticky": {"3": 9, "x": 1, "4": True}, "cooldown": []})
    assert timers.sticky == {3: 9} and timers.cooldown == {}
