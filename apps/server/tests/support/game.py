"""数据库测试用的一局游戏：真实 Postgres 上的服务、可编排的假模型、后台整理世界状态的 runner。

导演用流式脚本（director()），世界状态 agent 用一次回复里的一串工具调用（calls()）；
章节整理由假模型按请求里的回合号回复（chapter_reply()），切章的线很低，几回合就切一章；
大纲修订由假模型按请求里的原因回复（outline_reply()）。
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.memory.chapters import ChapterRule
from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import ChatRequest, ChatResult, EndpointPolicy, ToolCall, Usage
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.memory_runner import MemoryRunner, MemoryRunnerConfig
from bettertavern.runtime.outline_runner import OutlineRunner, OutlineRunnerConfig
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.runtime.state_runner import StateRunner, StateRunnerConfig
from bettertavern.services.container import (
    Services,
    build_memory_runner,
    build_outline_runner,
    build_services,
    build_state_runner,
)
from bettertavern.services.playthrough_service import NewPlaythrough
from bettertavern.services.route_inputs import RouteInput
from bettertavern.services.turn_service import ActionInput
from tests.fakes.runtime import ScriptedAdapter, StreamScript, result, scripted_hub
from tests.support.pg import schema_engine

SEED = {
    "world": {"title": "雨夜", "setting": "灰石镇"},
    "protagonist": {"name": "林川", "summary": "信使"},
    "characters": [{"name": "老周", "summary": "掌柜"}],
    "locations": [{"name": "酒馆"}, {"name": "码头"}],
    "opening": {"location": "酒馆", "present": ["老周"], "situation": "雨夜"},
}
CARD = {"spec": "chara_card_v2", "data": {"name": "老周", "description": "掌柜"}}


def director(n: int) -> list[str]:
    body = f"<narrative>\n第{n}段叙述。\n</narrative>\n<options>\n1. 甲{n}\n2. 乙{n}\n</options>"
    return [body[i : i + 6] for i in range(0, len(body), 6)]


def calls(*items: tuple[str, dict[str, Any]]) -> ChatResult:
    """世界状态 agent 的一次回复：依次调用这些工具。"""
    return ChatResult(
        text="",
        reasoning="",
        tool_calls=tuple(
            ToolCall(id=f"c{i}", name=name, arguments=json.dumps(args, ensure_ascii=False))
            for i, (name, args) in enumerate(items)
        ),
        finish_reason="tool_calls",
        usage=Usage(prompt=100, completion=20),
    )


def commit(
    digest: str, *entities: str, scene_ended: bool = False, outline_change: str = ""
) -> tuple[str, dict[str, Any]]:
    args: dict[str, Any] = {"digest": digest, "entities": list(entities)}
    args["scene_ended"] = scene_ended
    if outline_change:
        args["outline_change"] = outline_change
    return ("commit", args)


# 一回合大约 50 token：过了软线以后在场景结束处切，一直没有场景结束时三回合左右到硬线
CHAPTER_RULE = ChapterRule(soft_tokens=60, hard_tokens=150)
_TURN = re.compile(r"【第 (\d+) 回合】")


def chapter_reply(request: ChatRequest) -> ChatResult:
    """章节整理的假回复：摘要写明这一章覆盖哪几回合，要并梗概时梗概也写明。"""
    prompt = request.messages[-1].content
    seqs = [int(s) for s in _TURN.findall(prompt)]
    payload: dict[str, Any] = {
        "chapter_summary": f"第{seqs[0]}到{seqs[-1]}回合的摘要",
        "player_profile": f"截至第{seqs[-1]}回合的画像",
    }
    if "要并进去的一章" in prompt:
        payload["synopsis"] = f"截至第{seqs[-1]}回合之前的梗概"
    return ChatResult(
        text=json.dumps(payload, ensure_ascii=False),
        reasoning="",
        tool_calls=(),
        finish_reason="stop",
        usage=Usage(prompt=100, completion=20),
    )


_UPTO = re.compile(r"一直到第 (\d+) 回合")
_REASON = re.compile(r"^- 第 \d+ 回合：(.*)$", re.MULTILINE)


def outline_reply(request: ChatRequest) -> ChatResult:
    """大纲修订的假回复。第一版有三拍；之后原因里有“不改”时不改，否则把进行中的一拍标为完成、
    往后挪一拍。前提写明依据到第几回合。"""
    prompt = request.messages[-1].content
    found = _UPTO.findall(prompt)
    upto = int(found[-1]) if found else -1
    payload: dict[str, Any]
    if "现在的大纲：" not in prompt:
        beats = [
            {"id": f"b{i}", "status": "active" if i == 1 else "pending", "intent": f"第{i}拍"}
            for i in (1, 2, 3)
        ]
        payload = {"premise": f"截至第{upto}回合的大纲", "beats": beats, "constraints": []}
    else:
        current = prompt.split("现在的大纲：\n", 1)[1].split("\n\n", 1)[0]
        outline = json.loads(current)
        reasons = _REASON.findall(prompt.split("可能要改的地方：", 1)[1])
        if any("不改" in r for r in reasons):
            payload = {"change": False, "reason": "不用改"}
        else:
            beats = outline["beats"]
            index = next(i for i, b in enumerate(beats) if b["status"] == "active")
            beats[index]["status"] = "done"
            if index + 1 == len(beats):
                beats.append({"id": f"b{index + 2}", "intent": f"第{index + 2}拍"})
            beats[index + 1]["status"] = "active"
            outline["premise"] = f"截至第{upto}回合的大纲"
            payload = {"change": True, "reason": "；".join(reasons), "outline": outline}
    return ChatResult(
        text=json.dumps(payload, ensure_ascii=False),
        reasoning="",
        tool_calls=(),
        finish_reason="stop",
        usage=Usage(prompt=100, completion=20),
    )


def background_reply(request: ChatRequest) -> ChatResult:
    """后台的结构化输出：按请求的内容分给章节整理或大纲修订。"""
    if "<outline-source>" in request.messages[-1].content:
        return outline_reply(request)
    return chapter_reply(request)


@dataclass
class Game:
    services: Services
    state: StateRunner
    memory: MemoryRunner
    outline: OutlineRunner
    adapter: ScriptedAdapter
    engine: AsyncEngine
    user_id: str
    playthrough_id: str
    opening_id: str


async def finish(services: Services, turn_id: str) -> None:
    stream = services.buffers.get(turn_id)
    assert stream is not None
    async for _ in stream.subscribe(0):
        pass


@asynccontextmanager
async def new_game(url: str, tmp_path: Path, *, rollback_limit: int = 1) -> AsyncIterator[Game]:
    """注册、配好导演、导入角色卡、开局并等开场写完（世界状态还没整理）。"""
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
            runner_config=RunnerConfig(delta_batch_s=0.0, lease_renew_s=0.2),
            instance_id="test",
            rollback_limit=rollback_limit,
        )
        state = build_state_runner(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            config=StateRunnerConfig(turn_timeout_s=5.0),
        )
        memory = build_memory_runner(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            config=MemoryRunnerConfig(rule=CHAPTER_RULE, timeout_s=5.0),
        )
        outline = build_outline_runner(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            config=OutlineRunnerConfig(timeout_s=5.0),
        )
        user, _ = await services.auth.register("lin@example.com", "correct horse")
        await services.routes.create(
            user.id,
            RouteInput(
                provider="fake", model="fake-model", api_key="sk-test-123456", director=True
            ),
        )
        scenario = await services.scenarios.import_file(user.id, json.dumps(CARD).encode())
        adapter = adapters["fake"]
        adapter.responder = background_reply
        adapter.completions.append(result(json.dumps(SEED, ensure_ascii=False)))
        adapter.streams.append(StreamScript(director(0)))
        pt, opening = await services.playthroughs.create(
            user.id, NewPlaythrough(scenario_id=scenario.id, protagonist_name="林川")
        )
        await finish(services, opening.id)
        try:
            yield Game(
                services, state, memory, outline, adapter, engine, user.id, pt.id, opening.id
            )
        finally:
            await services.runners.shutdown(1.0)
            await hub.aclose()


async def rows(engine: AsyncEngine, sql: str, **params: Any) -> Sequence[Any]:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).all()


async def play(game: Game, n: int) -> str:
    """接着头部再玩一回合（点第一个选项），等它写完。返回回合 id。"""
    game.adapter.streams.append(StreamScript(director(n)))
    [(head,)] = await rows(
        game.engine,
        "SELECT head_turn_id::text FROM playthroughs WHERE id = :id",
        id=game.playthrough_id,
    )
    turn, _ = await game.services.turns.create(
        game.user_id,
        game.playthrough_id,
        parent_turn_id=head,
        action=ActionInput(source="option", option_id="o1"),
        idempotency_key=None,
    )
    await finish(game.services, turn.id)
    return turn.id
