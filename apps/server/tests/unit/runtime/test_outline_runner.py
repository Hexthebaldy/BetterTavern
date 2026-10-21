"""后台大纲修订：还没有大纲时写第一版；有大纲时按“要改”的原因决定改不改，改了的新一版按规则
修正（只留一拍进行中、完成过的拍不能改回去）；格式一直不对、调模型出错时记失败，不写入；
写入作废时返回 False。模型用按剧本回复的假适配器代替。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import pytest

from bettertavern.domain.memory.outline import Beat, Outline
from bettertavern.domain.routing import RouteTask
from bettertavern.domain.world.seed import ProtagonistSeed, Seed, WorldSeed
from bettertavern.domain.world.views import ThreadView
from bettertavern.providers import ErrorClass, ProviderError
from bettertavern.runtime.outline_runner import OutlineRunner, OutlineRunnerConfig
from bettertavern.runtime.ports import AgentRunRecord, OutlineCommit, OutlineWork, StoryMemory
from bettertavern.runtime.prompts import PromptBook
from tests.fakes.runtime import FakeRoutes, ScriptedAdapter, make_route, result, scripted_hub

pytestmark = pytest.mark.anyio

SEED = Seed(
    world=WorldSeed(title="雨夜灰石镇", setting="边境小镇，商会把持着码头。"),
    protagonist=ProtagonistSeed(name="林川", summary="落魄的信使", goal="把信送到"),
)

CURRENT = Outline(
    premise="林川要把一封封着火漆的信送到北境。",
    beats=[
        Beat(id="b1", status="done", intent="在酒馆接下送信的活"),
        Beat(id="b2", status="active", intent="甩掉码头的盯梢", done_when="出了镇子"),
        Beat(id="b3", intent="在驿站换马"),
    ],
    constraints=["寄信人的身份到北境前不能揭开"],
)


@dataclass
class FakeOutlineStore:
    work: OutlineWork | None
    commit_ok: bool = True
    committed: list[OutlineCommit] = field(default_factory=list)
    failed: list[AgentRunRecord] = field(default_factory=list)

    async def pending(self, playthrough_id: str) -> OutlineWork | None:
        return self.work

    async def commit(self, work: OutlineWork, result: OutlineCommit) -> bool:
        if not self.commit_ok:
            return False
        self.committed.append(result)
        return True

    async def fail(self, work: OutlineWork, run: AgentRunRecord) -> None:
        self.failed.append(run)


def work(outline: Outline | None = None, reasons: tuple[tuple[int, str], ...] = ()) -> OutlineWork:
    return OutlineWork(
        playthrough_id="pt-1",
        user_id="user-1",
        epoch=0,
        language="zh",
        protagonist_name="林川",
        outline_seq=-1 if outline is None else 5,
        based_on_seq=12,
        turn_id="turn-12",
        outline=outline,
        reasons=reasons,
        digests=((11, "林川在码头被人盯上。"), (12, "林川翻墙进了货栈。")),
        memory=StoryMemory(synopsis="林川在酒馆接下了送信的活。"),
        threads=(ThreadView("t1", "mystery", "谁封的这封信", answer="老周"),),
        seed=SEED,
    )


def outline_json(**changes: Any) -> dict[str, Any]:
    data = CURRENT.model_dump(mode="json")
    data.update(changes)
    return data


def runner(store: FakeOutlineStore) -> tuple[OutlineRunner, ScriptedAdapter]:
    hub, adapters = scripted_hub("fake")
    outline = OutlineRunner(
        store=store,
        routes=FakeRoutes({RouteTask.OUTLINE: make_route(task=RouteTask.OUTLINE)}),
        hub=hub,
        prompts=PromptBook(),
        config=OutlineRunnerConfig(timeout_s=5.0),
    )
    return outline, adapters["fake"]


def reply(data: dict[str, Any]) -> Any:
    return result(json.dumps(data, ensure_ascii=False))


async def test_nothing_happens_without_pending_work() -> None:
    store = FakeOutlineStore(None)
    outline, adapter = runner(store)
    assert await outline.process("pt-1") is False
    assert adapter.requests == []


async def test_the_first_outline_is_written_from_the_setting_and_settled() -> None:
    store = FakeOutlineStore(work())
    outline, adapter = runner(store)
    first = {
        "premise": "林川要把信送到北境。",
        "beats": [
            {"id": "b1", "status": "active", "intent": "甩掉盯梢"},
            {"id": "b1", "status": "active", "intent": "在驿站换马"},
            {"id": "b3", "status": "later", "intent": "到北境"},
        ],
        "constraints": [],
    }
    adapter.completions.append(reply(first))
    assert await outline.process("pt-1") is True
    [commit] = store.committed
    assert commit.outline is not None
    # 重复的编号换掉、多出来的进行中改回待写、认不得的状态当待写
    assert [(b.id, b.status) for b in commit.outline.beats] == [
        ("b1", "active"),
        ("b2", "pending"),
        ("b3", "pending"),
    ]
    run = commit.run
    assert run.agent == "outline_writer" and run.task == "outline" and run.status == "ok"
    assert run.result["first"] is True and run.result["changed"] is True
    assert run.result["active"] == "b1"
    prompt = adapter.requests[0].messages[-1].content
    assert "第一版" in prompt and "雨夜灰石镇" in prompt and "<outline-source>" in prompt
    assert "林川翻墙进了货栈。" in prompt and "老周" in prompt


async def test_a_revision_can_keep_the_outline() -> None:
    store = FakeOutlineStore(work(CURRENT, reasons=((9, "玩家在码头多逗留了一会儿"),)))
    outline, adapter = runner(store)
    adapter.completions.append(reply({"change": False, "reason": "只是暂时岔开"}))
    assert await outline.process("pt-1") is True
    [commit] = store.committed
    assert commit.outline is None and commit.reason == "只是暂时岔开"
    assert commit.run.result["changed"] is False and commit.run.result["first"] is False
    prompt = adapter.requests[0].messages[-1].content
    # 交给模型的是现在的大纲和要改的原因
    assert "玩家在码头多逗留了一会儿" in prompt and '"b2"' in prompt


async def test_a_revision_cannot_undo_a_finished_beat() -> None:
    store = FakeOutlineStore(work(CURRENT, reasons=((12, "这一拍完成了"),)))
    outline, adapter = runner(store)
    beats = [
        {"id": "b1", "status": "pending", "intent": "在酒馆接下送信的活"},
        {"id": "b2", "status": "done", "intent": "甩掉码头的盯梢"},
        {"id": "b3", "status": "pending", "intent": "在驿站换马"},
    ]
    adapter.completions.append(
        reply({"change": True, "reason": "出镇了", "outline": outline_json(beats=beats)})
    )
    assert await outline.process("pt-1") is True
    [commit] = store.committed
    assert commit.outline is not None
    assert [(b.id, b.status) for b in commit.outline.beats] == [
        ("b1", "done"),
        ("b2", "done"),
        ("b3", "active"),
    ]
    assert commit.run.result["active"] == "b3"


async def test_saying_change_without_an_outline_fails_without_writing() -> None:
    store = FakeOutlineStore(work(CURRENT, reasons=((12, "这一拍完成了"),)))
    outline, adapter = runner(store)
    for _ in range(4):
        adapter.completions.append(reply({"change": True, "reason": "要改"}))
    assert await outline.process("pt-1") is False
    assert store.committed == []
    [failed] = store.failed
    assert failed.status == "failed" and failed.error_class == "StructuredOutputError"


async def test_a_provider_error_is_recorded_as_a_failure() -> None:
    store = FakeOutlineStore(work())
    outline, adapter = runner(store)
    adapter.completions.append(ProviderError(ErrorClass.RATE_LIMIT, "slow down"))
    assert await outline.process("pt-1") is False
    [failed] = store.failed
    assert failed.error_class == ErrorClass.RATE_LIMIT.value
    assert failed.result == {"based_on_seq": 12, "first": True}


async def test_a_stale_write_returns_false() -> None:
    store = FakeOutlineStore(work(CURRENT, reasons=((12, "这一拍完成了"),)), commit_ok=False)
    outline, adapter = runner(store)
    adapter.completions.append(reply({"change": False, "reason": "不用改"}))
    assert await outline.process("pt-1") is False
    assert store.failed == []
