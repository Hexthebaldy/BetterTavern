"""工作台的 agent 模式：真实 Postgres + 可编排的假模型，runner 直接在测试里跑（不起 worker）。

一张原创卡的完整流程：问卷 → 回答 → 方案 → 确认 → 动手写（边写边推 field_delta）→ 写好 →
接着改（只能给改动对比）→ 采用；
以及手动接管、停止、同时开两轮、不能调用工具的模型、手动开始的草稿让 agent 接着写。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.scenario.edit import CardEdit
from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy, ToolCall
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.runtime.workbench_runner import WorkbenchRunner
from bettertavern.services.container import Services, build_services, build_workbench_runner
from bettertavern.services.errors import AppError
from bettertavern.services.route_inputs import RouteInput
from tests.fakes.runtime import ScriptedAdapter, StreamScript, scripted_hub
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@dataclass
class Bench:
    services: Services
    runner: WorkbenchRunner
    adapter: ScriptedAdapter
    engine: AsyncEngine
    user_id: str


@asynccontextmanager
async def bench(tmp_path: Path, *, tools: bool = True) -> AsyncIterator[Bench]:
    url = database_url()
    assert url is not None
    async with schema_engine(url, pool_size=10) as engine:
        hub, adapters = scripted_hub("fake")
        secrets = load_secrets(
            master_keys=new_master_key_entry("t1"),
            auth_secret="s" * 40,
            allow_dev_fallback=False,
            data_dir=tmp_path,
        )
        services = build_services(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            buffers=EventBufferRegistry(),
            access_ttl_s=900,
            refresh_ttl_s=3600,
            runner_config=RunnerConfig(),
            instance_id="test",
        )
        runner = build_workbench_runner(
            engine=engine, secrets=secrets, hub=hub, policy=EndpointPolicy()
        )
        user, _ = await services.auth.register("wen@example.com", "correct horse")
        await services.routes.create(
            user.id,
            RouteInput(
                provider="fake",
                model="fake-model",
                api_key="sk-test-123456",
                director=True,
                caps_override={} if tools else {"tools": False},
            ),
        )
        try:
            yield Bench(services, runner, adapters["fake"], engine, user.id)
        finally:
            await services.workbench.aclose()
            await hub.aclose()


def say(words: str = "", *calls: tuple[str, dict[str, Any]]) -> StreamScript:
    """模型的一次回复：先说 words（拆成小段），再依次调用这些工具（参数分两半到）。"""
    return StreamScript(
        pieces=[words[i : i + 4] for i in range(0, len(words), 4)],
        tool_calls=[
            ToolCall(id=f"c{i}", name=name, arguments=json.dumps(args, ensure_ascii=False))
            for i, (name, args) in enumerate(calls)
        ],
    )


async def pending_run(b: Bench, draft_id: str) -> str:
    async with b.engine.connect() as conn:
        row = (
            await conn.execute(
                text(
                    """SELECT payload->>'run_id' FROM jobs
                       WHERE kind = 'workbench.run' AND payload->>'draft_id' = :d
                       ORDER BY id DESC LIMIT 1"""
                ),
                {"d": draft_id},
            )
        ).scalar_one()
    return str(row)


async def run_once(b: Bench, draft_id: str) -> None:
    await b.runner.run(draft_id, await pending_run(b, draft_id))


async def event_types(b: Bench, draft_id: str) -> list[tuple[str, dict[str, Any]]]:
    async with b.engine.connect() as conn:
        rows = (
            await conn.execute(
                text("SELECT type, data FROM workbench_events WHERE draft_id = :d ORDER BY id"),
                {"d": draft_id},
            )
        ).all()
    return [(r[0], r[1]) for r in rows]


QUESTIONS = {
    "intro": "先定几件事",
    "questions": [
        {"question": "基调", "choices": ["悬疑", "温情", "恐怖"], "recommended": 0},
        {"question": "时代", "choices": ["民国", "现代"], "recommended": 0},
    ],
}
PLAN = {
    "names": ["温九", "沈当"],
    "pitch": "城南当铺的掌柜，收的是人的念想",
    "sections": [{"key": "personality", "heading": "性格", "body": "冷淡，守规矩"}],
    "lore": ["长生当", "三不当"],
    "opening": "雨夜，你推门进来",
    "cover": {"mode": "none"},
}
FIRST_MES = '（{{char}} 抬眼）客官，当什么？\n"规矩先说清楚。"'


async def test_original_card_from_questions_to_changes(tmp_path: Path) -> None:
    async with bench(tmp_path) as b:
        s = b.services
        draft = await s.workbench.start(b.user_id, text="做个民国当铺掌柜", language="zh")
        draft_id = draft.summary.id
        assert draft.summary.agent_status == "running" and draft.summary.origin == "agent"

        # 第一轮：先说一句，再发问卷 → 等用户回答
        b.adapter.streams.append(say("好的，先问两件事。", ("ask_user", QUESTIONS)))
        await run_once(b, draft_id)
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.summary.agent_status == "awaiting_user"
        assert view.summary.stage == "questions"
        assert view.summary.awaiting is not None and view.summary.awaiting["kind"] == "questions"
        offered = {t.name for t in b.adapter.requests[-1].tools or ()}
        assert "ask_user" in offered and "write_field" not in offered  # 没有方案不给写卡
        transcript = await s.workbench.transcript(b.user_id, draft_id)
        assert [(m.role, m.kind) for m in transcript.messages] == [
            ("user", "text"),
            ("assistant", "text"),
            ("assistant", "questions"),
        ]
        assert transcript.messages[1].content["text"] == "好的，先问两件事。"
        questions = transcript.messages[2].content["questions"]
        assert [q["qid"] for q in questions] == ["q0", "q1"]

        # 没在等方案时回复方案：409
        with pytest.raises(AppError) as info:
            await s.workbench.post(b.user_id, draft_id, "plan_reply", {"approved": True})
        assert info.value.code == "NOT_AWAITING"

        # 回答（第二题没答，按推荐项）→ 出方案
        await s.workbench.post(b.user_id, draft_id, "answers", {"answers": {"q0": "温情"}})
        transcript = await s.workbench.transcript(b.user_id, draft_id)
        assert transcript.messages[-1].content["answers"] == {"q0": "温情", "q1": "民国"}
        # 正在跑的时候再说话：409 DRAFT_BUSY
        with pytest.raises(AppError) as info:
            await s.workbench.post(b.user_id, draft_id, "text", {"text": "等等"})
        assert info.value.code == "DRAFT_BUSY"
        b.adapter.streams.append(say("", ("propose_plan", PLAN)))
        await run_once(b, draft_id)
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.summary.stage == "plan" and view.summary.awaiting["kind"] == "plan"  # type: ignore[index]
        # 第二轮的上下文里有用户的回答
        last_user = [m for m in b.adapter.requests[-1].messages if m.role == "user"][-1].content
        assert "温情" in last_user and "<workbench-state>" in last_user

        # 确认方案（选第二个名字）→ 动手写
        await s.workbench.post(
            b.user_id, draft_id, "plan_reply", {"approved": True, "name": "温九"}
        )
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.summary.stage == "build"
        b.adapter.streams.extend(
            [
                say(
                    "开始写。",
                    (
                        "update_todos",
                        {
                            "items": [
                                {"key": "basic", "text": "名字和描述", "state": "doing"},
                                {"key": "opening", "text": "开场白", "state": "todo"},
                            ]
                        },
                    ),
                    ("write_field", {"field": "name", "text": "温九"}),
                    (
                        "write_field",
                        {"field": "description", "text": "长生当的掌柜，{{char}} 不笑。"},
                    ),
                    ("write_field", {"field": "first_mes", "text": FIRST_MES}),
                ),
                say(
                    "",
                    (
                        "lore_upsert",
                        {"name": "长生当", "keys": ["当铺", "长生当"], "content": "城南的当铺。"},
                    ),
                    (
                        "lore_upsert",
                        {"name": "三不当", "content": "不当命，不当魂，不当情。", "constant": True},
                    ),
                    ("check_draft", {}),
                ),
                say("写好了：名字、描述、开场白和两条世界书。"),
            ]
        )
        await run_once(b, draft_id)
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.card.name == "温九"
        assert view.card.first_mes == FIRST_MES
        assert [e.name for e in view.card.book] == ["长生当", "三不当"]
        assert view.summary.stage == "done" and view.summary.agent_status == "idle"
        assert view.todos[0]["text"] == "名字和描述"
        build_tools = {t.name for t in b.adapter.requests[-3].tools or ()}
        assert "write_field" in build_tools and "ask_user" not in build_tools
        # 上下文里带着确认的方案和选中的名字
        assert '"chosen_name":"温九"' in b.adapter.requests[-3].messages[-1].content
        transcript = await s.workbench.transcript(b.user_id, draft_id)
        progress = transcript.messages[-1]
        assert progress.kind == "progress" and progress.content["complete"] is True
        assert progress.content["lore"] == {"added": 2}

        events = await event_types(b, draft_id)
        types = [t for t, _ in events]
        assert "delta" in types and "todos" in types and "draft" in types
        # 开场白一边生成一边推：拼起来就是全文（引号、换行都还原了）
        streamed = "".join(
            d["text"]
            for t, d in events
            if t == "field_delta" and d["target"] == {"field": "first_mes"}
        )
        assert streamed == FIRST_MES
        # 这一轮记一行 agent_runs，挂在草稿上
        async with b.engine.connect() as conn:
            runs = (
                await conn.execute(
                    text("SELECT agent, status, result FROM agent_runs WHERE draft_id = :d"),
                    {"d": draft_id},
                )
            ).all()
        assert [r[0] for r in runs] == ["card_maker"] * 3
        assert runs[-1][2]["written"] >= 4

        # 写好以后接着改：只能给改动对比，不能直接写
        await s.workbench.post(
            b.user_id, draft_id, "text", {"text": "开场白再冷一点，加一条世界书"}
        )
        b.adapter.streams.append(
            say(
                "",
                (
                    "propose_changes",
                    {
                        "changes": [
                            {
                                "target": {"field": "first_mes"},
                                "after": "（{{char}} 没抬眼）当什么。",
                                "summary": "更冷",
                            },
                            {
                                "target": {"lore_new": {"name": "后院", "keys": ["后院"]}},
                                "after": "后院不许进。",
                                "summary": "加一条",
                            },
                            {
                                "target": {"field": "personality"},
                                "after": "冷淡",
                                "summary": "补性格",
                            },
                        ]
                    },
                ),
            )
        )
        await run_once(b, draft_id)
        revise_tools = {t.name for t in b.adapter.requests[-1].tools or ()}
        assert "propose_changes" in revise_tools and "write_field" not in revise_tools
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.summary.awaiting is not None and view.summary.awaiting["kind"] == "changes"
        seq = view.summary.awaiting["seq"]
        assert view.card.first_mes == FIRST_MES  # 还没采用

        # 用户先手动改了性格：那一处采用时变成 stale
        await s.drafts.update_card(
            b.user_id,
            draft_id,
            version=view.summary.version,
            name=view.summary.name,
            edit=CardEdit.of(view.card.model_copy(update={"personality": "用户自己写的"})),
        )
        # 逐条看：先采用开场白，其余等会儿再说
        message, after = await s.workbench.decide(
            b.user_id, draft_id, seq, accept=["h1"], reject=[]
        )
        assert [h["state"] for h in message.content["hunks"]] == ["accepted", "pending", "pending"]
        assert after.card.first_mes == "（{{char}} 没抬眼）当什么。"
        assert after.summary.agent_status == "awaiting_user"  # 还有没决定的
        message, after = await s.workbench.decide(
            b.user_id, draft_id, seq, accept=None, reject=None, accept_all=True
        )
        assert [h["state"] for h in message.content["hunks"]] == ["accepted", "accepted", "stale"]
        assert after.card.personality == "用户自己写的"
        assert [e.name for e in after.card.book][-1] == "后院"
        assert after.summary.agent_status == "idle" and after.summary.awaiting is None
        with pytest.raises(AppError) as info:
            await s.workbench.decide(
                b.user_id, draft_id, seq, accept=None, reject=None, reject_all=True
            )
        assert info.value.code == "CHANGE_DECIDED"

        # 保存进仓库：agent 做的卡
        saved = await s.drafts.save(b.user_id, draft_id)
        assert saved.card.source == "agent" and saved.card.made_by == "agent"


async def test_manual_draft_handed_to_agent_keeps_user_edits(tmp_path: Path) -> None:
    async with bench(tmp_path) as b:
        s = b.services
        draft = await s.drafts.create_manual(b.user_id, language="zh")
        draft_id = draft.summary.id
        draft = await s.drafts.update_card(
            b.user_id,
            draft_id,
            version=1,
            name="",
            edit=CardEdit(name="阿七", description="用户写的描述"),
        )
        # 手动写到一半交给 agent：直接动手写，不问卷、不出方案
        await s.workbench.continue_(b.user_id, draft_id)
        b.adapter.streams.extend(
            [
                say("", ("write_field", {"field": "first_mes", "text": "掌柜的！"})),
                say("补好了开场白。"),
            ]
        )
        await run_once(b, draft_id)
        offered = {t.name for t in b.adapter.requests[0].tools or ()}
        assert "write_field" in offered and "ask_user" not in offered
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.card.first_mes == "掌柜的！" and view.card.description == "用户写的描述"
        assert view.summary.stage == "done"

        # 上一轮结束以后用户手动改了描述：下一轮 agent 想改它会被拒绝
        await s.drafts.update_card(
            b.user_id,
            draft_id,
            version=view.summary.version,
            name="",
            edit=CardEdit.of(view.card.model_copy(update={"description": "用户又改了"})),
        )
        await s.workbench.continue_(b.user_id, draft_id)
        b.adapter.streams.extend(
            [
                say("", ("write_field", {"field": "description", "text": "agent 的描述"})),
                say("描述是你改过的，我没动。"),
            ]
        )
        # 写好的卡“接着写完”仍是 revise：先把开场白清空，让它算没写完
        await s.drafts.update_card(
            b.user_id,
            draft_id,
            version=(await s.drafts.get(b.user_id, draft_id)).summary.version,
            name="",
            edit=CardEdit(name="阿七", description="用户又改了"),
        )
        await run_once(b, draft_id)
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.card.description == "用户又改了"
        last_tool_result = [m for m in b.adapter.requests[-1].messages if m.role == "tool"][-1]
        assert "用户手动改过" in last_tool_result.content
        state = b.adapter.requests[-2].messages[-1].content
        assert "用户手动改过的地方" in state and "description" in state


async def test_stop_busy_and_unsupported_model(tmp_path: Path) -> None:
    async with bench(tmp_path) as b:
        s = b.services
        draft = await s.workbench.start(b.user_id, text="随便做一个", language="en")
        draft_id = draft.summary.id
        # 用户点了停止（或切到手动接管）：这一轮不调模型，回到 idle
        assert await s.workbench.stop(b.user_id, draft_id) is True
        await run_once(b, draft_id)
        assert b.adapter.requests == []
        view = await s.drafts.get(b.user_id, draft_id)
        assert view.summary.agent_status == "idle"
        async with b.engine.connect() as conn:
            status = (
                await conn.execute(
                    text("SELECT status FROM agent_runs WHERE draft_id = :d"), {"d": draft_id}
                )
            ).scalar_one()
        assert status == "cancelled"
        assert await s.workbench.stop(b.user_id, draft_id) is False  # 没在跑

        # 一轮正在跑：不能再开；心跳过期以后可以
        await s.workbench.continue_(b.user_id, draft_id)
        with pytest.raises(AppError) as info:
            await s.workbench.continue_(b.user_id, draft_id)
        assert info.value.code == "DRAFT_BUSY"
        async with b.engine.begin() as conn:
            await conn.execute(
                text(
                    """UPDATE workbench_drafts SET run_heartbeat_at = now() - interval '1 hour'
                       WHERE id = :d"""
                ),
                {"d": draft_id},
            )
        assert (await s.drafts.get(b.user_id, draft_id)).summary.agent_status == "idle"
        stale_run = await pending_run(b, draft_id)
        await s.workbench.continue_(b.user_id, draft_id)
        # 旧的那一轮已经不是正在跑的了：什么都不做
        await b.runner.run(draft_id, stale_run)
        assert b.adapter.requests == []

        # 删草稿时 agent 在跑：先停，再删
        await s.workbench.stop(b.user_id, draft_id, quiet=True)
        await s.drafts.delete(b.user_id, draft_id)


async def test_model_without_tools_fails_the_round(tmp_path: Path) -> None:
    async with bench(tmp_path, tools=False) as b:
        s = b.services
        draft = await s.workbench.start(b.user_id, text="做一个", language="zh")
        await run_once(b, draft.summary.id)
        transcript = await s.workbench.transcript(b.user_id, draft.summary.id)
        assert transcript.messages[-1].kind == "error"
        assert transcript.messages[-1].content["code"] == "TOOLS_UNSUPPORTED"
        assert (await s.drafts.get(b.user_id, draft.summary.id)).summary.agent_status == "idle"


async def test_events_stream_resumes_after_an_id(tmp_path: Path) -> None:
    async with bench(tmp_path) as b:
        s = b.services
        draft = await s.workbench.start(b.user_id, text="做一个", language="zh")
        draft_id = draft.summary.id
        transcript = await s.workbench.transcript(b.user_id, draft_id)
        stream = await s.workbench.events(b.user_id, draft_id, after=transcript.last_event_id)
        b.adapter.streams.append(say("好。", ("ask_user", QUESTIONS)))
        worker = asyncio.create_task(run_once(b, draft_id))
        seen: list[str] = []
        iterator = aiter(stream)
        async with asyncio.timeout(10):
            while True:
                event = await anext(iterator)
                seen.append(event.event)
                if event.event == "status" and json.loads(event.data).get("done"):
                    break
        await worker
        await iterator.aclose()  # type: ignore[attr-defined]
        assert seen[0] == "status" and "delta" in seen and "message" in seen
        assert seen.count("message") == 2  # agent 说的话和问卷
