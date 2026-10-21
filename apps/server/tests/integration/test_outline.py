"""大纲修订（真实 Postgres，模型用可编排的假厂商）：开局后世界状态整理完第一回合就在后台写第一版
大纲；世界状态 agent 说“大纲要改”时放一个修订任务，修订把攒下的原因一起处理，改或不改都记一次；
导演在最后一条消息里看到大纲，世界状态 agent 看到当前这一拍；回退删掉依据超过目标回合的修订；
回退前开始的修订写入时作废；失败时原因留着，下一回合再试。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

from bettertavern.providers import ChatRequest, ChatResult, Usage
from bettertavern.runtime.ports import AgentRunRecord, OutlineCommit
from bettertavern.services.outline_store import PgOutlineStore
from tests.support.game import Game, background_reply, calls, commit, new_game, play, rows
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


async def keep(game: Game, seq: int, outline_change: str = "") -> None:
    game.adapter.completions.append(calls(commit(f"第{seq}回合", outline_change=outline_change)))
    assert await game.state.process(game.playthrough_id) == 1


async def advance(game: Game, seq: int, outline_change: str = "") -> None:
    await play(game, seq)
    await keep(game, seq, outline_change)


async def revisions(game: Game) -> list[tuple[Any, ...]]:
    found = await rows(
        game.engine,
        """SELECT based_on_seq, changed, content->>'premise', reason FROM outline_revisions
           WHERE playthrough_id = :pt ORDER BY based_on_seq""",
        pt=game.playthrough_id,
    )
    return [tuple(r) for r in found]


async def active_beat(game: Game) -> str:
    [(beat,)] = await rows(
        game.engine,
        """SELECT b->>'intent' FROM outline_revisions r,
                  jsonb_array_elements(r.content->'beats') b
           WHERE r.playthrough_id = :pt AND r.changed AND b->>'status' = 'active'
           ORDER BY r.based_on_seq DESC LIMIT 1""",
        pt=game.playthrough_id,
    )
    return str(beat)


async def outline_seq(game: Game) -> int:
    [(value,)] = await rows(
        game.engine,
        "SELECT outline_seq FROM playthroughs WHERE id = :pt",
        pt=game.playthrough_id,
    )
    return int(value)


async def outline_jobs(game: Game) -> int:
    """还没开始的大纲修订任务有几个；数完清掉（测试里直接调 process，不经过队列）。"""
    found = await rows(
        game.engine,
        """SELECT count(*) FROM jobs WHERE kind = 'memory.outline' AND status = 'pending'
           AND ordering_key = :key""",
        key=f"{game.playthrough_id}:memory",
    )
    async with game.engine.begin() as conn:
        await conn.execute(text("DELETE FROM jobs WHERE kind = 'memory.outline'"))
    return int(found[0][0])


def last_user_message(request: ChatRequest) -> str:
    return request.messages[-1].content


async def test_the_first_outline_is_written_after_the_opening_is_kept(game: Game) -> None:
    # 开场时还没有大纲
    assert "<outline>" not in last_user_message(game.adapter.requests[-1])
    await keep(game, 0)
    assert await outline_jobs(game) == 1
    assert await game.outline.process(game.playthrough_id) is True
    assert await revisions(game) == [(0, True, "截至第0回合的大纲", "")]
    assert await outline_seq(game) == 0
    # 没有新的原因：不再修订
    assert await game.outline.process(game.playthrough_id) is False
    # 下一回合导演在最后一条消息里看到大纲，世界状态 agent 看到当前这一拍
    await play(game, 1)
    director = last_user_message(game.adapter.requests[-1])
    assert director.index("</world-state>") < director.index("<outline>")
    assert "前提：截至第0回合的大纲\n当前这一拍：第1拍\n下一拍：第2拍" in director
    await keep(game, 1)
    assert "大纲当前这一拍：第1拍\n" in game.adapter.requests[-1].messages[1].content
    # 没说要改：不放修订任务
    assert await outline_jobs(game) == 0
    [run] = await rows(
        game.engine,
        """SELECT r.status, r.task, t.seq FROM agent_runs r JOIN turns t ON t.id = r.turn_id
           WHERE r.playthrough_id = :pt AND r.agent = 'outline_writer'""",
        pt=game.playthrough_id,
    )
    assert tuple(run) == ("ok", "outline", 0)


async def test_reasons_are_handled_together_and_keeping_is_recorded(game: Game) -> None:
    await keep(game, 0)
    await game.outline.process(game.playthrough_id)
    await advance(game, 1, outline_change="钥匙交出去了")
    await advance(game, 2, outline_change="老周收下了钥匙")
    # 修订还没做：整理第 2 回合时看得到第 1 回合说过的原因
    assert "还在等大纲修订处理的：\n- 第 1 回合：钥匙交出去了\n" in (
        game.adapter.requests[-1].messages[1].content
    )
    assert await outline_jobs(game) == 1
    assert await game.outline.process(game.playthrough_id) is True
    assert await revisions(game) == [
        (0, True, "截至第0回合的大纲", ""),
        (2, True, "截至第2回合的大纲", "钥匙交出去了；老周收下了钥匙"),
    ]
    assert await active_beat(game) == "第2拍"
    [(reason,)] = await rows(
        game.engine,
        "SELECT outline_reason FROM turn_notes WHERE playthrough_id = :pt AND seq = 1",
        pt=game.playthrough_id,
    )
    assert reason == "钥匙交出去了"
    # 不改也记一次，进度前进；导演看到的还是上一版
    await advance(game, 3, outline_change="玩家岔开了，先不改")
    assert await game.outline.process(game.playthrough_id) is True
    assert (await revisions(game))[-1] == (3, False, None, "不用改")
    assert await outline_seq(game) == 3
    await play(game, 4)
    assert "当前这一拍：第2拍" in last_user_message(game.adapter.requests[-1])


async def test_rollback_drops_revisions_past_the_target(game: Game) -> None:
    await keep(game, 0)
    await game.outline.process(game.playthrough_id)
    await advance(game, 1, outline_change="完成了一拍")
    await game.outline.process(game.playthrough_id)
    await advance(game, 2, outline_change="又完成了一拍")
    # 回退前开始的修订：写入时作废
    store = PgOutlineStore(game.engine)
    work = await store.pending(game.playthrough_id)
    assert work is not None and work.based_on_seq == 2
    [(turn1,)] = await rows(
        game.engine,
        "SELECT id::text FROM turns WHERE playthrough_id = :pt AND seq = 1",
        pt=game.playthrough_id,
    )
    await outline_jobs(game)
    await game.services.playthroughs.rollback(game.user_id, game.playthrough_id, turn1)
    run = AgentRunRecord(agent="outline_writer", task="outline", status="ok")
    assert await store.commit(work, OutlineCommit(outline=None, reason="", run=run)) is False
    assert [r[0] for r in await revisions(game)] == [0, 1]
    assert await outline_seq(game) == 1
    assert await active_beat(game) == "第2拍"
    # 没删修订时不放任务
    assert await outline_jobs(game) == 0
    [(turn0,)] = await rows(
        game.engine,
        "SELECT id::text FROM turns WHERE playthrough_id = :pt AND seq = 0",
        pt=game.playthrough_id,
    )
    await game.services.playthroughs.rollback(game.user_id, game.playthrough_id, turn0)
    assert [r[0] for r in await revisions(game)] == [0]
    assert await outline_seq(game) == 0
    # 删了修订：放一个任务，由它看还有没有要处理的（这里没有）
    assert await outline_jobs(game) == 1
    assert await game.outline.process(game.playthrough_id) is False
    [(stale,)] = await rows(
        game.engine,
        "SELECT count(*) FROM agent_runs WHERE agent = 'outline_writer' AND status = 'stale'",
    )
    assert stale == 1


async def test_a_failed_revision_keeps_the_reason_for_the_next_turn(game: Game) -> None:
    await keep(game, 0)
    await game.outline.process(game.playthrough_id)
    await advance(game, 1, outline_change="完成了一拍")
    await outline_jobs(game)

    def broken(request: ChatRequest) -> ChatResult:
        return ChatResult(
            text="不是 JSON",
            reasoning="",
            tool_calls=(),
            finish_reason="stop",
            usage=Usage(prompt=10, completion=5),
        )

    game.adapter.responder = broken
    assert await game.outline.process(game.playthrough_id) is False
    game.adapter.responder = background_reply
    assert await outline_seq(game) == 0
    [(status, error)] = await rows(
        game.engine,
        """SELECT status, error_class FROM agent_runs
           WHERE agent = 'outline_writer' ORDER BY created_at DESC LIMIT 1""",
    )
    assert (status, error) == ("failed", "StructuredOutputError")
    # 下一回合整理完，还有没处理的原因：再放一个任务，这次成功
    await advance(game, 2)
    assert await outline_jobs(game) == 1
    assert await game.outline.process(game.playthrough_id) is True
    assert (await revisions(game))[-1][:2] == (2, True)
