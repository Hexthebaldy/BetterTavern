"""章节整理（真实 Postgres，模型用可编排的假厂商）：世界状态整理完一回合就放一个章节整理任务；
够切一章时写章节摘要、玩家画像，第 4 章时把最早一章并进全书梗概；导演的上下文里换成回顾加
当前这一章的原文；回退删掉覆盖范围超过目标回合的摘要，玩家画像不动。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from tests.support.game import Game, calls, commit, new_game, play, rows
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


async def keep(game: Game, seq: int, *, scene_ended: bool = False) -> None:
    game.adapter.completions.append(calls(commit(f"第{seq}回合", scene_ended=scene_ended)))
    assert await game.state.process(game.playthrough_id) == 1


async def advance(game: Game, upto: int) -> None:
    """玩到第 upto 回合，每回合整理完世界状态再看要不要写章节。"""
    [(head,)] = await rows(
        game.engine,
        "SELECT seq FROM turns WHERE id = (SELECT head_turn_id FROM playthroughs WHERE id = :pt)",
        pt=game.playthrough_id,
    )
    for seq in range(head + 1, upto + 1):
        await play(game, seq)
        await keep(game, seq)
        await game.memory.process(game.playthrough_id)


async def summaries(game: Game) -> list[tuple[str, int, int, str]]:
    found = await rows(
        game.engine,
        """SELECT kind, first_seq, last_seq, text FROM story_summaries
           WHERE playthrough_id = :pt ORDER BY kind, last_seq""",
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


async def test_each_kept_turn_queues_a_chapter_job(game: Game) -> None:
    await keep(game, 0)
    jobs = await rows(
        game.engine,
        "SELECT kind, status FROM jobs WHERE ordering_key = :key",
        key=f"{game.playthrough_id}:memory",
    )
    # 同一条队列里还有写第一版大纲的任务（tests/integration/test_outline.py）
    assert sorted(jobs) == [("memory.chapter", "pending"), ("memory.outline", "pending")]
    # 还不够切一章：什么都不写
    assert await game.memory.process(game.playthrough_id) == 0
    assert await summaries(game) == [] and await summarized(game) == -1


async def test_chapters_are_cut_at_scene_ends_and_folded_into_the_synopsis(game: Game) -> None:
    await keep(game, 0)
    await play(game, 1)
    await keep(game, 1, scene_ended=True)
    # 第 0、1 回合过了软线，第 1 回合场景结束：切一章
    assert await game.memory.process(game.playthrough_id) == 1
    assert await summaries(game) == [("chapter", 0, 1, "第0到1回合的摘要")]
    assert await summarized(game) == 1
    [(run_seq, status)] = await rows(
        game.engine,
        """SELECT t.seq, r.status FROM agent_runs r JOIN turns t ON t.id = r.turn_id
           WHERE r.playthrough_id = :pt AND r.agent = 'chapter_writer'""",
        pt=game.playthrough_id,
    )
    assert (run_seq, status) == (1, "ok")
    # 之后一直没有场景结束：每四回合到硬线切一章；第 4、5 章写好时各把最早一章并进梗概
    await advance(game, 17)
    chapters = [s for s in await summaries(game) if s[0] == "chapter"]
    assert [(s[1], s[2]) for s in chapters] == [(0, 1), (2, 5), (6, 9), (10, 13), (14, 17)]
    synopses = [s for s in await summaries(game) if s[0] == "synopsis"]
    assert [(s[1], s[2]) for s in synopses] == [(0, 1), (0, 5)]
    profiles = await rows(
        game.engine,
        "SELECT based_on_seq FROM player_profiles WHERE playthrough_id = :pt ORDER BY created_at",
        pt=game.playthrough_id,
    )
    assert [p[0] for p in profiles] == [1, 5, 9, 13, 17]

    # 导演的上下文：回顾里是最新的梗概和最近 3 章，原文从第 16 回合开始（多留上一章最后两回合）
    await play(game, 18)
    request = game.adapter.requests[-1]
    system = request.messages[0].content
    assert "截至第17回合之前的梗概" in system
    assert "### 第 6–9 回合" in system and "### 第 14–17 回合" in system
    assert "### 第 2–5 回合" not in system and "截至第17回合的画像" in system
    assert "第16段叙述" in request.messages[2].content
    assert not any("第15段叙述" in m.content for m in request.messages)
    # 第 16 回合之前的回合不在上下文里：提供召回工具
    assert request.tools is not None and "从第 16 回合开始" in request.messages[-1].content


async def test_rollback_drops_summaries_past_the_target_but_keeps_profiles(game: Game) -> None:
    await keep(game, 0)
    await advance(game, 10)
    before = await summaries(game)
    # 回退到第 5 回合：有的摘要覆盖到它之后，有的没有
    assert any(s[2] > 5 for s in before) and any(s[2] <= 5 for s in before)
    [(target,)] = await rows(
        game.engine,
        """SELECT id::text FROM turns WHERE playthrough_id = :pt AND seq = 5
           AND status IN ('replied', 'committed')""",
        pt=game.playthrough_id,
    )
    profiles_before = await rows(
        game.engine,
        "SELECT count(*) FROM player_profiles WHERE playthrough_id = :pt",
        pt=game.playthrough_id,
    )
    await game.services.playthroughs.rollback(game.user_id, game.playthrough_id, target)
    after = await summaries(game)
    written = await rows(
        game.engine,
        "SELECT max(written_seq) FROM story_summaries WHERE playthrough_id = :pt",
        pt=game.playthrough_id,
    )
    # 在第 5 回合之后写的都删了，包括覆盖更早回合、但之后才并出来的梗概
    assert written[0][0] is None or written[0][0] <= 5
    assert all(s in before for s in after) and all(s[2] <= 5 for s in after)
    chapters = [s[2] for s in after if s[0] == "chapter"]
    assert await summarized(game) == (max(chapters) if chapters else -1)
    profiles_after = await rows(
        game.engine,
        "SELECT count(*) FROM player_profiles WHERE playthrough_id = :pt",
        pt=game.playthrough_id,
    )
    assert profiles_after == profiles_before
