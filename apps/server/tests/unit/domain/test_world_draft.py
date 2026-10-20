"""世界状态 agent 的修改清单：每个操作当场检查、作用到副本上，收尾时算出每一行的改动。"""

from __future__ import annotations

import itertools

import pytest

from bettertavern.domain.world.draft import MAX_NEW_ENTITIES, DraftError, DraftIssues, WorldDraft
from bettertavern.domain.world.invariants import check_world, new_issues
from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.records import (
    EntityRecord,
    FactRecord,
    LinkRecord,
    WorldRecords,
)


def entity(id: str, kind: str, name: str, **kw: object) -> EntityRecord:
    return EntityRecord(id=id, kind=kind, name=name, name_norm=normalize_name(name), **kw)  # type: ignore[arg-type]


WORLD = WorldRecords(
    entities=(
        entity(
            "w",
            "world",
            "世界",
            data={"scene": {"location": "tavern", "present": ["zhou"], "goal": "找到信"}},
        ),
        entity("hero", "character", "林川", is_protagonist=True),
        entity("zhou", "character", "老周", aliases=("周掌柜",), summary="掌柜", last_seen_seq=2),
        entity("tavern", "location", "灰石酒馆"),
        entity("dock", "location", "码头"),
        entity("key", "item", "铜钥匙"),
        entity("old", "character", "老兵", retired=True),
    ),
    links=(
        LinkRecord("hero", "located_in", "tavern"),
        LinkRecord("zhou", "located_in", "tavern"),
        LinkRecord("key", "held_by", "hero"),
    ),
    facts=(
        FactRecord(
            id="f-secret",
            text="老周欠商会的钱",
            entity_ids=("zhou",),
            visibility="secret",
            known_by=("zhou",),
        ),
    ),
)


def draft(seq: int = 5, world: WorldRecords = WORLD) -> WorldDraft:
    counter = itertools.count(1)
    return WorldDraft(world, seq=seq, turn_id="turn-5", new_id=lambda: f"new-{next(counter)}")


def code_of(excinfo: pytest.ExceptionInfo[DraftError]) -> str:
    return excinfo.value.code


# ---- 指代 ----


def test_refs_and_names_resolve_to_the_same_entity() -> None:
    d = draft()
    zhou = d.resolve("老周")
    assert d.resolve(d.ref(zhou.id)).id == "zhou"
    assert d.resolve("周 掌柜").id == "zhou"  # 别名，空格不影响
    with pytest.raises(DraftError) as missing:
        d.resolve("阿福")
    assert code_of(missing) == "unknown_entity"
    with pytest.raises(DraftError) as retired:
        d.resolve("老兵")
    assert code_of(retired) == "retired_entity"
    assert d.resolve("老兵", active=False).id == "old"
    with pytest.raises(DraftError):
        d.resolve("e99")
    # world 实体不让模型直接改
    with pytest.raises(DraftError):
        d.resolve(d.ref("w"))


def test_find_lists_exact_matches_first_and_includes_retired() -> None:
    d = draft()
    assert [e.id for e in d.find("老")] == ["zhou", "old"]
    assert [e.id for e in d.find("老兵")] == ["old"]
    assert d.find("") == []


# ---- 新建与修改 ----


def test_created_entities_are_sketches_with_their_first_turn() -> None:
    d = draft()
    record = d.create_entity(
        kind="character", name=" 阿福 ", summary="跑堂", details={"goal": "攒钱"}
    )
    assert (record.canon, record.first_seq, record.last_seen_seq) == ("sketch", 5, 5)
    assert record.name == "阿福" and record.data == {"goal": "攒钱"}
    assert d.ref(record.id) == "e8"
    with pytest.raises(DraftError) as taken:
        d.create_entity(kind="character", name="老周", summary="")
    assert code_of(taken) == "name_taken"
    # 退场的不占名字
    assert d.create_entity(kind="character", name="老兵", summary="新来的").id == "new-2"
    with pytest.raises(DraftError) as detail:
        d.create_entity(kind="item", name="信", summary="", details={"goal": "x"})
    assert code_of(detail) == "bad_detail"


def test_new_entities_per_turn_are_limited() -> None:
    d = draft()
    for i in range(MAX_NEW_ENTITIES):
        d.create_entity(kind="item", name=f"物品{i}", summary="")
    with pytest.raises(DraftError) as excinfo:
        d.create_entity(kind="item", name="又一个", summary="")
    assert code_of(excinfo) == "too_many_new"


def test_established_entities_keep_their_summary() -> None:
    d = draft()
    with pytest.raises(DraftError) as excinfo:
        d.update_entity("老周", summary="其实是间谍")
    assert code_of(excinfo) == "canon_summary"
    updated = d.update_entity("老周", aliases=["老周头", "周掌柜"], details={"condition": "受伤"})
    assert updated.aliases == ("周掌柜", "老周头")
    assert updated.data == {"condition": "受伤"}
    assert d.update_entity("老周", details={"condition": ""}).data == {}


def test_retiring_removes_from_scene_but_not_the_protagonist() -> None:
    d = draft()
    with pytest.raises(DraftError) as hero:
        d.retire_entity("林川")
    assert code_of(hero) == "protected_entity"
    with pytest.raises(DraftError) as place:
        d.retire_entity("灰石酒馆")
    assert code_of(place) == "retire_scene_location"
    d.retire_entity("老周")
    assert d.world.data["scene"]["present"] == []
    assert d.entity("zhou").retired


# ---- 位置 ----


def test_an_item_is_in_one_place_at_a_time() -> None:
    d = draft()
    rel, _, _ = d.move("铜钥匙", "老周")
    assert rel == "held_by"
    places = [lk.key for lk in d.links if lk.src_id == "key"]
    assert places == [("key", "held_by", "zhou")]
    d.move("铜钥匙", "码头")
    assert [lk.key for lk in d.links if lk.src_id == "key"] == [("key", "located_in", "dock")]
    with pytest.raises(DraftError) as hero:
        d.move("林川", "码头")
    assert code_of(hero) == "move_protagonist"
    with pytest.raises(DraftError) as bad:
        d.move("老周", "铜钥匙")
    assert code_of(bad) == "bad_destination"


def test_a_character_who_leaves_is_no_longer_present() -> None:
    d = draft()
    d.move("老周", "码头")
    assert d.world.data["scene"]["present"] == []


def test_changing_the_scene_moves_the_protagonist() -> None:
    d = draft()
    scene = d.set_scene(location="码头")
    assert scene["location"] == "dock"
    assert d.place_of("hero") is not None and d.place_of("hero")[1].id == "dock"  # type: ignore[index]
    # 新地点原来没有人：在场名单是空的，老周还在酒馆
    assert scene["present"] == []
    assert d.place_of("zhou")[1].id == "tavern"  # type: ignore[index]


def test_present_list_is_authoritative() -> None:
    d = draft()
    fu = d.create_entity(kind="character", name="阿福", summary="")
    d.set_scene(present=[d.ref(fu.id)])
    assert d.world.data["scene"]["present"] == [fu.id]
    assert d.place_of(fu.id)[1].id == "tavern"  # type: ignore[index]
    # 老周不在名单里，不再算在酒馆
    assert d.place_of("zhou") is None
    assert not check_world(d.snapshot())


def test_links_follow_kind_rules() -> None:
    d = draft()
    with pytest.raises(DraftError) as place:
        d.link("老周", "located_in", "码头")
    assert code_of(place) == "use_move"
    with pytest.raises(DraftError) as kinds:
        d.link("铜钥匙", "member_of", "码头")
    assert code_of(kinds) == "bad_link_kinds"
    d.link("码头", "part_of", "灰石酒馆")
    d.unlink("码头", "part_of", "灰石酒馆")
    with pytest.raises(DraftError) as gone:
        d.unlink("码头", "part_of", "灰石酒馆")
    assert code_of(gone) == "unknown_link"


# ---- 事实 ----


def test_facts_are_retracted_not_deleted() -> None:
    d = draft()
    newer = d.add_fact("老周还清了欠款", about=["老周"])
    old = d.retract_fact("f1", replaced_by=d.fact_ref(newer.id))
    assert (old.status, old.superseded_seq, old.superseded_by) == ("superseded", 5, newer.id)
    assert [f.id for f in d.facts] == [newer.id]
    assert newer.source_turn_id == "turn-5" and newer.created_seq == 5
    with pytest.raises(DraftError) as twice:
        d.retract_fact("f1")
    assert code_of(twice) == "retracted_fact"


def test_sharing_a_secret_with_the_protagonist() -> None:
    d = draft()
    shared = d.share_fact("f1", ["林川"])
    assert shared.known_by == ("zhou", "hero")
    public = d.add_fact("酒馆在下雨", about=["灰石酒馆"])
    with pytest.raises(DraftError) as excinfo:
        d.share_fact(d.fact_ref(public.id), ["林川"])
    assert code_of(excinfo) == "fact_public"


# ---- 收尾 ----


def test_finish_marks_who_was_seen_and_promotes_sketches() -> None:
    sketch = entity("fu", "character", "阿福", canon="sketch", first_seq=3, last_seen_seq=3)
    world = WorldRecords((*WORLD.entities, sketch), WORLD.links, WORLD.facts)
    d = draft(world=world)
    d.move("铜钥匙", "老周")
    result = d.finish(digest=" 我把钥匙交给了老周 ", entities=["阿福"], scene_ended=True)
    assert result.digest == "我把钥匙交给了老周" and result.scene_ended
    assert result.entity_ids == ("fu",)
    fu = d.entity("fu")
    assert (fu.canon, fu.last_seen_seq) == ("canon", 5)
    # 关系两端都算出现过
    assert d.entity("zhou").last_seen_seq == 5 and d.entity("hero").last_seen_seq == 5
    assert d.entity("tavern").last_seen_seq == 0
    targets = [c.target for c in result.changes]
    assert targets == sorted(targets, key=["entity", "link", "fact"].index)
    by_id = {c.after["id"]: c for c in result.changes if c.target == "entity" and c.after}
    assert by_id["zhou"].before is not None and by_id["zhou"].after["rev"] == 2  # type: ignore[index]
    links = [(c.before, c.after) for c in result.changes if c.target == "link"]
    assert ({"src_id": "key", "rel": "held_by", "dst_id": "hero", "since_seq": 0}, None) in links
    with pytest.raises(DraftError) as again:
        d.move("铜钥匙", "码头")
    assert code_of(again) == "already_committed"


def test_a_sketch_seen_only_in_its_first_turn_stays_a_sketch() -> None:
    d = draft()
    fu = d.create_entity(kind="character", name="阿福", summary="")
    result = d.finish(digest="来了个跑堂", entities=[d.ref(fu.id)], scene_ended=False)
    created = next(c for c in result.changes if c.after and c.after["id"] == fu.id)
    assert created.before is None and created.after["canon"] == "sketch"  # type: ignore[index]


def test_finish_needs_a_digest() -> None:
    with pytest.raises(DraftError) as excinfo:
        draft().finish(digest="  ", entities=[], scene_ended=False)
    assert code_of(excinfo) == "empty_digest"


def test_nothing_changed_still_finishes() -> None:
    d = draft()
    result = d.finish(digest="我坐着发呆", entities=[], scene_ended=False)
    assert result.changes == ()


# ---- 一致性规则 ----


def test_check_world_finds_two_places_and_retired_presence() -> None:
    broken = WorldRecords(
        entities=WORLD.entities,
        links=(*WORLD.links, LinkRecord("key", "located_in", "dock")),
        facts=(),
    )
    codes = [i.code for i in check_world(broken)]
    assert codes == ["two_places"]
    scene = entity("w", "world", "世界", data={"scene": {"present": ["old"]}})
    retired_present = WorldRecords((scene, *WORLD.entities[1:]), WORLD.links, ())
    assert [i.code for i in check_world(retired_present)] == ["present_retired"]


def test_only_new_issues_block_a_commit() -> None:
    broken = WorldRecords(
        entities=WORLD.entities,
        links=(*WORLD.links, LinkRecord("key", "located_in", "dock")),
        facts=(),
    )
    # 开局时就有的问题不算这一回合的
    assert new_issues(broken, broken) == []
    assert [i.code for i in new_issues(WORLD, broken)] == ["two_places"]
    with pytest.raises(DraftIssues):
        d = draft(world=WORLD)
        d._links[("key", "located_in", "dock")] = LinkRecord("key", "located_in", "dock")
        d.finish(digest="出错了", entities=[], scene_ended=False)
