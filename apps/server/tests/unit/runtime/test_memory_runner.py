"""后台章节整理：够切一章才写，写章节摘要和玩家画像；已经有 3 章时顺带把最早一章并进全书梗概；
积压了好几章时一次写完；失败或写入作废就停下。模型用按剧本回复的假适配器代替。"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass, field

import pytest

from bettertavern.domain.memory.chapters import ChapterRule
from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.providers import ErrorClass, ProviderError
from bettertavern.runtime.memory_runner import MemoryRunner, MemoryRunnerConfig
from bettertavern.runtime.ports import (
    AgentRunRecord,
    ChapterCommit,
    ChapterSummary,
    ChapterTurn,
    MemoryWork,
    StoryMemory,
)
from bettertavern.runtime.prompts import PromptBook
from tests.fakes.runtime import FakeRoutes, ScriptedAdapter, make_route, result, scripted_hub

pytestmark = pytest.mark.anyio

# 每回合约 50 token（20 个汉字 + 固定的 40）：两回合过软线，四回合到硬线
RULE = ChapterRule(soft_tokens=100, hard_tokens=200)


def turn(seq: int, *, ended: bool = False) -> ChapterTurn:
    return ChapterTurn(
        turn_id=f"turn-{seq}",
        seq=seq,
        action=PlayerAction("text", "我" * 5),
        narrative="雨" * 15 + f"（{seq}）",
        scene_ended=ended,
    )


@dataclass
class FakeMemoryStore:
    work: MemoryWork
    commit_ok: bool = True
    committed: list[ChapterCommit] = field(default_factory=list)
    failed: list[AgentRunRecord] = field(default_factory=list)

    async def pending(self, playthrough_id: str) -> MemoryWork | None:
        return self.work

    async def commit(self, work: MemoryWork, result: ChapterCommit) -> bool:
        if not self.commit_ok:
            return False
        self.committed.append(result)
        # 和数据库一样：覆盖进度前进，章节摘要加一条；并进梗概的那一章不再单列
        memory = work.memory
        chapters = (
            *memory.chapters,
            ChapterSummary(result.first_seq, result.last_seq, result.chapter),
        )
        if result.synopsis_last_seq is not None:
            chapters = tuple(c for c in chapters if c.last_seq > result.synopsis_last_seq)
        self.work = dataclasses.replace(
            work,
            turns=tuple(t for t in work.turns if t.seq > result.last_seq),
            memory=StoryMemory(
                synopsis=result.synopsis or memory.synopsis,
                synopsis_last_seq=result.synopsis_last_seq or memory.synopsis_last_seq,
                chapters=chapters,
                profile=result.profile,
                summarized_seq=result.last_seq,
            ),
        )
        return True

    async def fail(self, work: MemoryWork, run: AgentRunRecord) -> None:
        self.failed.append(run)


def work(*turns_: ChapterTurn, memory: StoryMemory | None = None) -> MemoryWork:
    return MemoryWork(
        playthrough_id="pt-1",
        user_id="user-1",
        epoch=0,
        language="zh",
        protagonist_name="林川",
        turns=turns_,
        memory=memory or StoryMemory(),
    )


def written(chapter: str, *, synopsis: str | None = None) -> str:
    payload = {"chapter_summary": chapter, "player_profile": f"画像：{chapter}"}
    if synopsis is not None:
        payload["synopsis"] = synopsis
    return json.dumps(payload, ensure_ascii=False)


def runner(store: FakeMemoryStore) -> tuple[MemoryRunner, ScriptedAdapter]:
    hub, adapters = scripted_hub("fake")
    route = make_route(task=RouteTask.COMPACTOR)
    memory = MemoryRunner(
        store=store,
        routes=FakeRoutes({RouteTask.COMPACTOR: route}),
        hub=hub,
        prompts=PromptBook(),
        config=MemoryRunnerConfig(rule=RULE, timeout_s=5.0),
    )
    return memory, adapters["fake"]


async def test_nothing_is_written_before_a_chapter_is_due() -> None:
    store = FakeMemoryStore(work(turn(1, ended=True), turn(2)))
    memory, adapter = runner(store)
    assert await memory.process("pt-1") == 0
    assert adapter.requests == [] and store.committed == []


async def test_a_chapter_is_cut_at_the_scene_end_after_the_soft_line() -> None:
    store = FakeMemoryStore(work(turn(1, ended=True), turn(2), turn(3, ended=True), turn(4)))
    memory, adapter = runner(store)
    adapter.completions.append(result(written("林川打听到了火漆的来历。")))
    assert await memory.process("pt-1") == 1
    [commit] = store.committed
    assert (commit.first_seq, commit.last_seq) == (1, 3)
    assert commit.chapter == "林川打听到了火漆的来历。"
    assert commit.profile == "画像：林川打听到了火漆的来历。" and commit.synopsis is None
    run = commit.run
    assert run.agent == "chapter_writer" and run.status == "ok"
    assert run.result["first_seq"] == 1 and run.result["last_seq"] == 3
    # 发给模型的是这一章的原文，第 4 回合不在里面
    prompt = adapter.requests[0].messages[-1].content
    assert "【第 3 回合】" in prompt and "【第 4 回合】" not in prompt
    assert "<chapter-turns>" in prompt and "synopsis" not in prompt


async def test_the_oldest_of_three_chapters_is_folded_into_the_synopsis() -> None:
    chapters = (
        ChapterSummary(0, 9, "第一章：林川到了灰石镇。"),
        ChapterSummary(10, 19, "第二章：林川去了码头。"),
        ChapterSummary(20, 29, "第三章：林川北上。"),
    )
    memory_now = StoryMemory(chapters=chapters, profile="喜欢谨慎", summarized_seq=29)
    store = FakeMemoryStore(work(turn(30), turn(31), turn(32), turn(33), memory=memory_now))
    memory, adapter = runner(store)
    adapter.completions.append(result(written("第四章：林川回到镇上。", synopsis="梗概")))
    assert await memory.process("pt-1") == 1
    [commit] = store.committed
    assert commit.synopsis == "梗概" and commit.synopsis_last_seq == 9
    prompt = adapter.requests[0].messages[-1].content
    # 要并进去的是第一章；前几章的摘要里只列还留着的两章；上一版画像也给了
    assert "要并进去的一章（第 0–9 回合）：\n第一章：林川到了灰石镇。" in prompt
    assert "- 第 10–19 回合：第二章" in prompt and "- 第 0–9 回合" not in prompt
    assert "上一版玩家画像：\n喜欢谨慎" in prompt


async def test_a_backlog_is_written_chapter_by_chapter() -> None:
    # 一直没有场景结束：每四回合到硬线切一章
    store = FakeMemoryStore(work(*(turn(seq) for seq in range(1, 10))))
    memory, adapter = runner(store)
    adapter.completions.extend([result(written("一")), result(written("二"))])
    assert await memory.process("pt-1") == 2
    assert [(c.first_seq, c.last_seq) for c in store.committed] == [(1, 4), (5, 8)]
    # 第二章的提示词里有第一章的摘要和第一版画像
    second = adapter.requests[1].messages[-1].content
    assert "- 第 1–4 回合：一" in second and "上一版玩家画像：\n画像：一" in second


async def test_failure_is_recorded_and_stops() -> None:
    store = FakeMemoryStore(work(turn(1), turn(2, ended=True)))
    memory, adapter = runner(store)
    adapter.completions.append(ProviderError(ErrorClass.SERVER_ERROR, "boom"))
    assert await memory.process("pt-1") == 0
    [run] = store.failed
    assert run.status == "failed" and run.error_class == "server_error"
    assert run.result == {"first_seq": 1, "last_seq": 2}


async def test_a_stale_write_stops() -> None:
    store = FakeMemoryStore(work(turn(1), turn(2, ended=True)), commit_ok=False)
    memory, adapter = runner(store)
    adapter.completions.append(result(written("一")))
    assert await memory.process("pt-1") == 0
    assert len(adapter.requests) == 1
