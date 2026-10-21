"""线索的修改清单：记下、解开、每回合的上限、重复，以及算出的改动（回退时倒着写回）。"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from bettertavern.domain.world.draft import DraftError
from bettertavern.domain.world.records import ThreadRecord
from bettertavern.domain.world.threads import MAX_NEW_THREADS, MAX_OPEN_THREADS, ThreadDraft

OLD = ThreadRecord(id="a", kind="mystery", text="谁放的火", opened_seq=3)
DONE = ThreadRecord(
    id="b", kind="promise", text="已解开", status="closed", opened_seq=1, closed_seq=2
)


def ids() -> Callable[[], str]:
    counter = iter(range(100))
    return lambda: f"new-{next(counter)}"


def draft() -> ThreadDraft:
    return ThreadDraft([OLD, DONE], seq=9, turn_id="turn-9", new_id=ids())


def test_only_open_threads_get_refs() -> None:
    threads = draft()
    assert [t.id for t in threads.open_threads] == ["a"]
    assert threads.ref("a") == "t1" and threads.label("t1") == "谁放的火"
    with pytest.raises(DraftError) as err:
        threads.resolve("t2")
    assert err.value.code == "unknown_thread"


def test_open_and_close_produce_row_changes() -> None:
    threads = draft()
    new = threads.open("promise", "  老周  答应帮我打听 ", ["zhou", "zhou"])
    assert new.text == "老周 答应帮我打听" and new.entity_ids == ("zhou",)
    assert threads.ref(new.id) == "t2"
    threads.close("t1")
    created, closed = threads.changes()
    assert created.before is None and created.after == new.to_json()
    assert new.opened_seq == 9 and new.source_turn_id == "turn-9"
    assert closed.before == OLD.to_json()
    assert closed.after is not None and closed.after["closed_seq"] == 9
    # 解开以后不在没解开的列表里
    assert [t.id for t in threads.open_threads] == [new.id]


def test_rules_are_checked_when_called() -> None:
    threads = draft()
    for kind, text, code in (
        ("rumor", "随便", "bad_thread_kind"),
        ("mystery", "   ", "empty_thread"),
        ("mystery", "谁放的火", "duplicate_thread"),
    ):
        with pytest.raises(DraftError) as err:
            threads.open(kind, text, [])
        assert err.value.code == code
    for i in range(MAX_NEW_THREADS):
        threads.open("mystery", f"悬念{i}", [])
    with pytest.raises(DraftError) as err:
        threads.open("mystery", "再来一条", [])
    assert err.value.code == "too_many_threads"
    threads.close("t1")
    with pytest.raises(DraftError) as err:
        threads.close("t1")
    assert err.value.code == "thread_closed"


def test_opened_and_closed_in_the_same_turn_is_one_new_row() -> None:
    threads = draft()
    threads.open("mystery", "一闪而过的人影", [])
    threads.close("t2")
    [change] = threads.changes()
    assert change.before is None and change.after is not None
    assert change.after["status"] == "closed"


def test_open_threads_have_a_cap() -> None:
    many = [
        ThreadRecord(id=f"o{i}", kind="mystery", text=f"悬念{i}", opened_seq=i)
        for i in range(MAX_OPEN_THREADS)
    ]
    threads = ThreadDraft(many, seq=40, turn_id="turn-40", new_id=ids())
    with pytest.raises(DraftError) as err:
        threads.open("mystery", "再来一条", [])
    assert err.value.code == "too_many_open_threads"
    # 先解开一条就能记了
    threads.close("t1")
    assert threads.open("mystery", "再来一条", []).text == "再来一条"


def test_merging_threads_about_the_same_matter() -> None:
    a = ThreadRecord(
        id="a", kind="mystery", text="兜帽客知道谁封的信", entity_ids=("hood",), opened_seq=9
    )
    b = ThreadRecord(
        id="b",
        kind="mystery",
        text="两个人在等这封信",
        entity_ids=("letter",),
        opened_seq=12,
        answer="一个是商会旧派，一个是韩管事",
    )
    threads = ThreadDraft([a, b], seq=30, turn_id="turn-30", new_id=ids())
    merged = threads.merge(
        ["t1", "t2"], kind="mystery", text="这封信是谁封的、要交给谁", entity_ids=["hood"]
    )
    # 涉及的实体合在一起；没给答案时沿用旧线索里的
    assert merged.entity_ids == ("hood", "letter")
    assert merged.answer == "一个是商会旧派，一个是韩管事"
    assert [t.id for t in threads.open_threads] == [merged.id]
    old_a, old_b, new = threads.changes()
    assert old_a.after is not None and old_a.after["status"] == "merged"
    assert old_a.after["merged_into"] == merged.id and old_a.after["closed_seq"] == 30
    assert old_b.before == b.to_json()
    # 新的那一条排在最后：回退时倒着写回，先删它，再把旧的恢复成没解开
    assert new.before is None and new.after == merged.to_json()
    with pytest.raises(DraftError) as err:
        threads.merge(["t3"], kind="mystery", text="只有一条", entity_ids=[])
    assert err.value.code == "merge_needs_two"


def test_answers_can_be_written_later() -> None:
    threads = draft()
    threads.update("t1", answer="  火是老周的仇家放的  ")
    [change] = threads.changes()
    assert change.before == OLD.to_json()
    assert change.after is not None and change.after["answer"] == "火是老周的仇家放的"
    assert change.after["status"] == "open"
    with pytest.raises(DraftError) as err:
        threads.update("t1", text="  ")
    assert err.value.code == "empty_thread"
