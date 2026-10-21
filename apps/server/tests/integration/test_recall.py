"""召回阶段的读写（真实 Postgres）：导演的隐藏备注存进回合、交给世界状态 agent、回到之后的上下文；
召回工具只查当前故事线上更早的回合。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from bettertavern.services.recall_store import PgRecallStore
from bettertavern.services.turn_service import ActionInput
from tests.fakes.runtime import StreamScript
from tests.support.game import Game, calls, commit, finish, new_game, rows
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def game(tmp_path: Path) -> AsyncIterator[Game]:
    assert URL is not None
    async with new_game(URL, tmp_path, rollback_limit=5) as started:
        yield started


async def say(game: Game, action: str, narrative: str, notes: str = "") -> str:
    """玩家自己写一句行动，导演回这一段叙述（可以带隐藏备注）。返回回合 id。"""
    text = f"<narrative>\n{narrative}\n</narrative>\n<options>\n1. 甲\n2. 乙\n</options>"
    if notes:
        text += f"\n<director-notes>\n{notes}\n</director-notes>"
    game.adapter.streams.append(StreamScript([text[i : i + 5] for i in range(0, len(text), 5)]))
    [(head,)] = await rows(
        game.engine,
        "SELECT head_turn_id::text FROM playthroughs WHERE id = :id",
        id=game.playthrough_id,
    )
    turn, _ = await game.services.turns.create(
        game.user_id,
        game.playthrough_id,
        parent_turn_id=head,
        action=ActionInput(source="text", text=action),
        idempotency_key=None,
    )
    await finish(game.services, turn.id)
    return turn.id


async def keep(game: Game, digest: str, *entities: str) -> None:
    game.adapter.completions.append(calls(commit(digest, *entities)))
    assert await game.state.process(game.playthrough_id) == 1


async def entity_id(game: Game, name: str) -> str:
    [(value,)] = await rows(
        game.engine,
        "SELECT id::text FROM entities WHERE playthrough_id = :pt AND name = :name",
        pt=game.playthrough_id,
        name=name,
    )
    return str(value)


async def test_director_notes_reach_the_state_keeper_and_later_turns(game: Game) -> None:
    await keep(game, "开场")
    turn_id = await say(game, "我问火漆的事", "老周不说话。", notes="伏笔：老周认得这枚火漆。")
    [(stored,)] = await rows(
        game.engine, "SELECT director_notes FROM turns WHERE id = :id", id=turn_id
    )
    assert stored == "伏笔：老周认得这枚火漆。"
    # 接口不返回隐藏备注
    detail = await game.services.turns.get(game.user_id, turn_id)
    assert "伏笔" not in str(detail)
    game.adapter.completions.append(
        calls(
            ("open_thread", {"kind": "foreshadow", "text": "老周认得这枚火漆", "about": ["老周"]}),
            commit("打听火漆", "老周"),
        )
    )
    assert await game.state.process(game.playthrough_id) == 1
    state_request = game.adapter.requests[-1]
    assert "<director-notes>\n伏笔：老周认得这枚火漆。\n</director-notes>" in (
        state_request.messages[-1].content
    )
    # 下一回合导演的上下文里，那一回合的回复带着当时的备注
    await say(game, "我离开", "雨停了。")
    director_request = game.adapter.requests[-1]
    replies = [m.content for m in director_request.messages if m.role == "assistant"]
    assert replies[-1].endswith("<director-notes>\n伏笔：老周认得这枚火漆。\n</director-notes>")
    # 世界状态 agent 据此记下的线索涉及在场的老周，出现在状态块里
    assert "（伏笔，第 1 回合起，已过 1 回合）老周认得这枚火漆" in (
        director_request.messages[-1].content
    )


async def test_recall_reads_only_earlier_turns_on_the_current_timeline(game: Game) -> None:
    store = PgRecallStore(game.engine)
    zhou = await entity_id(game, "老周")
    await keep(game, "开场")
    await say(game, "我问老周认不认识火漆", "老周说火漆上压着一只乌鸦。")
    await keep(game, "向老周打听火漆", "老周")
    await say(game, "我去码头", "码头空荡荡的，只有乌鸦在叫。")
    await keep(game, "去了码头")
    await say(game, "我回酒馆", "火漆还放在柜台上。")
    await keep(game, "回到酒馆", "老周")

    found = await store.search(game.playthrough_id, ["乌鸦"], before_seq=3, limit=5)
    assert [t.seq for t in found] == [2, 1]
    assert found[1].action.text == "我问老周认不认识火漆" and found[1].digest == "向老周打听火漆"
    # 关键词也在一句话摘要里找；% 不是通配符
    assert [
        t.seq for t in await store.search(game.playthrough_id, ["码头"], before_seq=9, limit=5)
    ] == [2]
    assert await store.search(game.playthrough_id, ["%"], before_seq=9, limit=5) == []
    # 按实体找：回合标签里记了老周的回合，第 3 回合在上下文里不算
    about = await store.turns_with(game.playthrough_id, [zhou], before_seq=3, limit=5)
    assert [t.seq for t in about] == [1]
    one = await store.turn(game.playthrough_id, 1)
    assert one is not None and one.narrative == "老周说火漆上压着一只乌鸦。"

    # 回退到第 1 回合：第 2、3 回合归档，不再能查到
    [(first,)] = await rows(
        game.engine,
        "SELECT id::text FROM turns WHERE playthrough_id = :pt AND seq = 1",
        pt=game.playthrough_id,
    )
    await game.services.playthroughs.rollback(game.user_id, game.playthrough_id, first)
    after = await store.search(game.playthrough_id, ["乌鸦"], before_seq=9, limit=5)
    assert [t.seq for t in after] == [1]
    assert await store.turn(game.playthrough_id, 2) is None
    world = await store.world(game.playthrough_id)
    assert any(e.name == "老周" for e in world.entities)
