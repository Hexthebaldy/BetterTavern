"""回退（真实 Postgres，模型用可编排的假厂商）。

一致性：玩到第 N 回合再回退到第 K 回合，世界状态（实体、关系、事实）、回合标签和整理进度，
要和当初刚整理完第 K 回合时逐行相同。随机走很多步“往前玩几回合 / 回退到更早的某一回合”来检查。
"""

from __future__ import annotations

import random
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

from bettertavern.runtime.ports import AgentRunRecord, StateCommit
from bettertavern.services.errors import AppError
from bettertavern.services.state_store import PgStateStore
from tests.support.game import Game, calls, commit, new_game, play, rows
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def game(tmp_path: Path) -> AsyncIterator[Game]:
    assert URL is not None
    async with new_game(URL, tmp_path, rollback_limit=100) as started:
        yield started


def state_script(seq: int) -> list[tuple[str, dict[str, Any]]]:
    """第 seq 回合世界状态 agent 要做的修改：轮流用到新建、移动、改状态、换场景、
    关系、退场、事实和推翻事实。有的调用会被拒绝（例如推翻不存在的事实），也是确定的。"""
    kind = seq % 4
    if kind == 0:
        return [
            ("create_entity", {"kind": "item", "name": f"物品{seq}", "summary": "新东西"}),
            ("move", {"entity": f"物品{seq}", "to": "老周"}),
            ("add_fact", {"text": f"第{seq}回合老周收下了东西", "about": ["老周"]}),
            commit(f"第{seq}回合", "老周"),
        ]
    if kind == 1:
        return [
            ("set_scene", {"location": "码头", "goal": f"目标{seq}"}),
            ("update_entity", {"entity": "老周", "details": {"condition": f"状态{seq}"}}),
            ("set_clock", {"time": f"第{seq}天"}),
            commit(f"第{seq}回合", "林川"),
        ]
    if kind == 2:
        return [
            ("set_scene", {"location": "酒馆", "present": ["老周"]}),
            ("retract_fact", {"fact": "f1"}),
            (
                "add_fact",
                {
                    "text": f"第{seq}回合的秘密",
                    "about": ["老周"],
                    "secret": True,
                    "known_by": ["老周"],
                },
            ),
            commit(f"第{seq}回合", "老周"),
        ]
    return [
        ("create_entity", {"kind": "character", "name": f"路人{seq}", "summary": "过客"}),
        ("link", {"src": f"路人{seq}", "rel": "knows_of", "dst": "老周"}),
        ("move", {"entity": f"路人{seq}", "to": "码头"}),
        ("retire_entity", {"entity": f"路人{seq}"}),
        commit(f"第{seq}回合", f"路人{seq}"),
    ]


async def keep(game: Game, seq: int) -> None:
    game.adapter.completions.append(calls(*state_script(seq)))
    assert await game.state.process(game.playthrough_id) == 1


async def snapshot(game: Game) -> dict[str, list[tuple[Any, ...]]]:
    queries = {
        "entities": """SELECT id, kind, name, name_norm, aliases, summary, data, canon,
                              is_protagonist, first_seq, last_seen_seq, rev, retired
                       FROM entities WHERE playthrough_id = :pt ORDER BY id""",
        "links": """SELECT src_id, rel, dst_id, since_seq FROM entity_links
                    WHERE playthrough_id = :pt ORDER BY src_id, rel, dst_id""",
        "facts": """SELECT id, text, entity_ids, visibility, known_by, status, superseded_by,
                           superseded_seq, created_seq, source_turn_id
                    FROM facts WHERE playthrough_id = :pt ORDER BY id""",
        "notes": """SELECT turn_id, seq, digest, entity_ids, scene_ended, skipped
                    FROM turn_notes WHERE playthrough_id = :pt ORDER BY seq""",
        "progress": "SELECT state_seq FROM playthroughs WHERE id = :pt",
    }
    return {
        name: [tuple(r) for r in await rows(game.engine, sql, pt=game.playthrough_id)]
        for name, sql in queries.items()
    }


async def turn_at(game: Game, seq: int) -> str:
    [(turn_id,)] = await rows(
        game.engine,
        """SELECT id::text FROM turns WHERE playthrough_id = :pt AND seq = :seq
           AND status IN ('replied', 'committed')""",
        pt=game.playthrough_id,
        seq=seq,
    )
    return turn_id


async def test_rollback_restores_the_world_exactly(game: Game) -> None:
    rng = random.Random(20261022)
    await keep(game, 0)
    snapshots = {0: await snapshot(game)}
    head = 0
    rollbacks = 0
    for step in range(14):
        if head < 2 or step % 3 != 2:
            for _ in range(rng.randint(1, 3)):
                head += 1
                await play(game, head)
                await keep(game, head)
                snapshots[head] = await snapshot(game)
            continue
        target = rng.randint(0, head - 1)
        detail = await game.services.playthroughs.rollback(
            game.user_id, game.playthrough_id, await turn_at(game, target)
        )
        assert detail.head is not None and detail.head.seq == target
        assert await snapshot(game) == snapshots[target], f"回退到第 {target} 回合"
        for seq in [s for s in snapshots if s > target]:
            del snapshots[seq]
        head = target
        rollbacks += 1
    assert rollbacks >= 3
    archived = await rows(game.engine, "SELECT count(*) FROM turns WHERE status = 'archived'")
    assert archived[0][0] > 0


async def test_rollback_while_the_world_is_behind(game: Game) -> None:
    # 世界状态只整理到第 1 回合，玩到第 4 回合后退回第 3 回合：第 2、3 回合接着整理
    await keep(game, 0)
    await play(game, 1)
    await keep(game, 1)
    for seq in (2, 3, 4):
        await play(game, seq)
    detail = await game.services.playthroughs.rollback(
        game.user_id, game.playthrough_id, await turn_at(game, 3)
    )
    assert detail.playthrough.state_seq == 1
    jobs = await rows(game.engine, "SELECT count(*) FROM jobs WHERE status = 'pending'")
    assert jobs[0][0] == 1
    game.adapter.completions.extend([calls(*state_script(2)), calls(*state_script(3))])
    assert await game.state.process(game.playthrough_id) == 2
    [(progress,)] = await rows(
        game.engine, "SELECT state_seq FROM playthroughs WHERE id = :id", id=game.playthrough_id
    )
    assert progress == 3


async def test_work_started_before_a_rollback_is_dropped(game: Game) -> None:
    await keep(game, 0)
    await play(game, 1)
    await play(game, 2)
    store = PgStateStore(game.engine)
    turn = await store.next_turn(game.playthrough_id)
    assert turn is not None and turn.seq == 1
    # 整理第 1 回合期间玩家回退到了第 1 回合：回退前读到的东西写入时作废
    await game.services.playthroughs.rollback(
        game.user_id, game.playthrough_id, await turn_at(game, 1)
    )
    late = StateCommit(
        changes=(),
        digest="回退前整理的",
        entity_ids=(),
        scene_ended=False,
        run=AgentRunRecord(agent="state_keeper", task="state_keeper", status="ok"),
    )
    assert await store.commit(turn, late) is False
    assert not await rows(game.engine, "SELECT 1 FROM turn_notes WHERE seq = 1")
    # 回退时放了新任务，重新整理第 1 回合
    game.adapter.completions.append(calls(*state_script(1)))
    assert await game.state.process(game.playthrough_id) == 1
    [(digest,)] = await rows(game.engine, "SELECT digest FROM turn_notes WHERE seq = 1")
    assert digest == "第1回合"


async def rollback_error(game: Game, seq_or_id: int | str) -> str:
    turn_id = seq_or_id if isinstance(seq_or_id, str) else await turn_at(game, seq_or_id)
    with pytest.raises(AppError) as excinfo:
        await game.services.playthroughs.rollback(game.user_id, game.playthrough_id, turn_id)
    return excinfo.value.code


async def test_rollback_refusals(game: Game) -> None:
    await keep(game, 0)
    await play(game, 1)
    await play(game, 2)
    assert await rollback_error(game, 2) == "ALREADY_AT_TURN"
    # 有回合正在生成（租约没过期）：不回退
    async with game.engine.begin() as conn:
        await conn.execute(
            text(
                """UPDATE playthroughs SET active_turn_id = :turn,
                   lease_expires_at = now() + interval '1 minute' WHERE id = :id"""
            ),
            {"turn": game.opening_id, "id": game.playthrough_id},
        )
    assert await rollback_error(game, 0) == "TURN_IN_PROGRESS"
    async with game.engine.begin() as conn:
        await conn.execute(
            text("UPDATE playthroughs SET active_turn_id = NULL, lease_expires_at = NULL"),
        )
    old_turn = await turn_at(game, 2)
    await game.services.playthroughs.rollback(
        game.user_id, game.playthrough_id, await turn_at(game, 1)
    )
    # 被回退掉的回合不在故事线上了
    assert await rollback_error(game, old_turn) == "NOT_ON_TIMELINE"


async def test_rollbacks_are_limited_per_save(tmp_path: Path) -> None:
    assert URL is not None
    async with new_game(URL, tmp_path, rollback_limit=1) as game:
        await keep(game, 0)
        await play(game, 1)
        await play(game, 2)
        before = await game.services.playthroughs.get(game.user_id, game.playthrough_id)
        assert before.playthrough.rollbacks_left == 1
        after = await game.services.playthroughs.rollback(
            game.user_id, game.playthrough_id, await turn_at(game, 1)
        )
        assert after.playthrough.rollbacks_left == 0
        assert await rollback_error(game, 0) == "ROLLBACK_LIMIT_REACHED"


async def test_rollback_reopens_an_ended_story(game: Game) -> None:
    await keep(game, 0)
    await play(game, 1)
    async with game.engine.begin() as conn:
        await conn.execute(
            text("UPDATE playthroughs SET status = 'ended' WHERE id = :id"),
            {"id": game.playthrough_id},
        )
    detail = await game.services.playthroughs.rollback(
        game.user_id, game.playthrough_id, await turn_at(game, 0)
    )
    assert detail.playthrough.status == "active"
