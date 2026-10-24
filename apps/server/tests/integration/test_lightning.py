"""闪电模式的后台压缩（真实 Postgres，模型用可编排的假厂商）：每回合存好放一个压缩任务，
不到阈值不调模型；到了阈值把较早的回合压成一版梗概，导演的上下文换成梗概加之后的原文；
压缩请求的开头和导演上一回合的请求一样；回退删掉回退点之后写的梗概。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy import text

from bettertavern.runtime.ports import AgentRunRecord, CompressCommit
from tests.support.game import Game, new_game, play, rows
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def game(tmp_path: Path) -> AsyncIterator[Game]:
    assert URL is not None
    async with new_game(URL, tmp_path, rollback_limit=5, lightning=True) as started:
        yield started


async def synopses(game: Game) -> list[tuple[str, int, int, str]]:
    found = await rows(
        game.engine,
        """SELECT kind, first_seq, last_seq, text FROM story_summaries
           WHERE playthrough_id = :pt ORDER BY last_seq""",
        pt=game.playthrough_id,
    )
    return [tuple(r) for r in found]


async def summarized(game: Game) -> int:
    [(value,)] = await rows(
        game.engine,
        "SELECT summarized_seq FROM playthroughs WHERE id = :pt",
        pt=game.playthrough_id,
    )
    return int(value)


async def test_turns_queue_a_compress_job_and_nothing_for_the_world_state(game: Game) -> None:
    await play(game, 1)
    jobs = await rows(
        game.engine,
        "SELECT kind, status FROM jobs WHERE ordering_key LIKE :pt || ':%'",
        pt=game.playthrough_id,
    )
    assert sorted(jobs) == [("memory.lightning", "pending")]
    [(status,)] = await rows(
        game.engine,
        "SELECT status FROM turns WHERE playthrough_id = :pt AND seq = 1",
        pt=game.playthrough_id,
    )
    assert status == "committed"
    # 还不到阈值：不调模型，什么都不写
    sent = len(game.adapter.requests)
    assert await game.lightning.process(game.playthrough_id) is False
    assert len(game.adapter.requests) == sent
    assert await synopses(game) == [] and await summarized(game) == -1


async def test_old_turns_are_compressed_into_a_synopsis(game: Game) -> None:
    head = 0
    director_request = game.adapter.requests[-1]
    while await summarized(game) < 0:
        head += 1
        await play(game, head)
        director_request = game.adapter.requests[-1]
        await game.lightning.process(game.playthrough_id)
        assert head < 10, "一直没压缩"
    [(kind, first, last, text)] = await synopses(game)
    assert (kind, first) == ("synopsis", 0) and text == f"截至第{last}回合的梗概"
    assert await summarized(game) == last and last <= head - 2  # 最近两回合留着
    # 压缩请求的开头就是导演上一回合的整个请求（前缀缓存）
    compress_request = game.adapter.requests[-1]
    assert "<synopsis>" in compress_request.messages[-1].content
    assert compress_request.messages[: len(director_request.messages)] == director_request.messages
    run = await rows(
        game.engine,
        """SELECT t.seq, r.status, r.task FROM agent_runs r JOIN turns t ON t.id = r.turn_id
           WHERE r.playthrough_id = :pt AND r.agent = 'compressor'""",
        pt=game.playthrough_id,
    )
    assert [tuple(r) for r in run] == [(last, "ok", "director")]

    # 下一回合导演的上下文：回顾里是梗概，原文从梗概之后开始，不多留
    await play(game, head + 1)
    request = game.adapter.requests[-1]
    assert f"截至第{last}回合的梗概" in request.messages[0].content
    assert f"第{last + 1}段叙述" in request.messages[2].content
    assert not any(f"第{last}段叙述" in m.content for m in request.messages)
    assert request.tools is None

    # 再压一次：新梗概是旧梗概加上之后的回合
    while await summarized(game) == last:
        head += 1
        await play(game, head + 1)
        await game.lightning.process(game.playthrough_id)
        assert head < 20, "一直没有第二次压缩"
    second = await synopses(game)
    assert len(second) == 2 and second[1][2] == await summarized(game)
    assert "<recap> 里的全书梗概和" in game.adapter.requests[-1].messages[-1].content


async def compress_once(game: Game) -> int:
    """接着玩到压缩一次为止，返回头部回合号。"""
    [(head,)] = await rows(
        game.engine,
        "SELECT seq FROM turns WHERE id = (SELECT head_turn_id FROM playthroughs WHERE id = :pt)",
        pt=game.playthrough_id,
    )
    before = await summarized(game)
    while await summarized(game) == before:
        head += 1
        await play(game, head)
        await game.lightning.process(game.playthrough_id)
        assert head < 30, "一直没压缩"
    return int(head)


async def turn_id(game: Game, seq: int) -> str:
    [(found,)] = await rows(
        game.engine,
        """SELECT id::text FROM turns WHERE playthrough_id = :pt AND seq = :seq
           AND status IN ('replied', 'committed')""",
        pt=game.playthrough_id,
        seq=seq,
    )
    return str(found)


async def test_rollback_drops_synopses_written_after_the_target(game: Game) -> None:
    head = await compress_once(game)
    last = await summarized(game)
    # 回退到梗概覆盖的范围之后：梗概留着，覆盖进度不变
    await game.services.playthroughs.rollback(
        game.user_id, game.playthrough_id, await turn_id(game, head - 1)
    )
    assert [s[2] for s in await synopses(game)] == [last] and await summarized(game) == last
    # 回退到梗概覆盖的回合之前：只玩到那时还没有这版梗概，删掉；原文又从第 0 回合开始
    await game.services.playthroughs.rollback(
        game.user_id, game.playthrough_id, await turn_id(game, last - 1)
    )
    assert await synopses(game) == [] and await summarized(game) == -1
    await play(game, last)
    request = game.adapter.requests[-1]
    assert "梗概" not in request.messages[0].content
    assert "第0段叙述" in request.messages[2].content or "第1段叙述" in request.messages[2].content
    # 接着玩，到阈值时照样压
    await compress_once(game)
    assert len(await synopses(game)) == 1


async def test_a_stale_result_is_dropped(game: Game) -> None:
    await compress_once(game)
    store = game.lightning._store
    work = await store.pending(game.playthrough_id)
    assert work is not None
    before = await synopses(game)
    first = work.context.history[0].seq
    result = CompressCommit(
        first_seq=first,
        last_seq=first,
        synopsis="不该写进去的梗概",
        run=AgentRunRecord(agent="compressor", task="director", status="ok"),
    )
    # 别处已经压过一次（覆盖进度变了）：这次的结果作废，不写梗概，运行记为 stale
    async with game.engine.begin() as conn:
        await conn.execute(
            text("UPDATE playthroughs SET summarized_seq = summarized_seq + 1 WHERE id = :pt"),
            {"pt": game.playthrough_id},
        )
    assert await store.commit(work, result) is False
    assert await synopses(game) == before
    runs = await rows(
        game.engine,
        "SELECT status FROM agent_runs WHERE playthrough_id = :pt AND agent = 'compressor'",
        pt=game.playthrough_id,
    )
    assert sorted(r[0] for r in runs) == ["ok", "stale"]
