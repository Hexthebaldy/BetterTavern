"""闪电模式的压缩（docs/agent-runtime.md 的“闪电模式”）：
把旧梗概和较早的一段原文合成一版新的全书梗概。

省钱靠前缀缓存：请求的开头就是导演下一回合会发的那一段（规则和设定、回顾、原文），只是最后一条消息
换成整理要求。导演上一回合的请求是这段开头的前缀，所以开头那一大段都能命中服务商的缓存。
用导演的模型，不开推理；输出是 <synopsis> 标签里的文字，一次拿到，不走结构化输出阶梯。
压到第几回合由代码按长度定（domain/memory/lightning.py），写入数据库由调用方
（runtime/lightning_runner.py）做。
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass, replace

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.providers import (
    ChatRequest,
    ChatResult,
    Message,
    NegativeCapabilityCache,
    ProviderAdapter,
    ProviderError,
    ReasoningConfig,
    ToolSpec,
)
from bettertavern.runtime.agent import (
    AgentSpec,
    ModelReply,
    OutputKind,
    StepLog,
    clip_text,
    run_agent,
)
from bettertavern.runtime.context.assembler import ContextAssembler
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.ports import TurnContext
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "compressor"
SPEC = AgentSpec(name=AGENT, task=RouteTask.DIRECTOR, output=OutputKind.TAGGED_TEXT)

# 提示词里要求的上限：中文、日文 1500 字，英文 1000 词；超出一点的截掉，不让梗概越写越长
SYNOPSIS_CHARS = 1500
SYNOPSIS_WORDS = 1000
SYNOPSIS_LIMIT = 1800
# 梗概最多约 1500 字，留足输出
MIN_OUTPUT_TOKENS = 3000


class EmptySynopsis(Exception):
    """模型没写出梗概（标签里是空的，或者整段都是空白）。"""


@dataclass(frozen=True)
class Compressed:
    synopsis: str
    prompt_hash: str
    truncated: bool  # 模型在 </synopsis> 之前就停了


def compress_messages(
    ctx: TurnContext, last_seq: int, prompts: PromptLibrary, window: int
) -> tuple[list[Message], str]:
    """导演下一回合上下文的开头（去掉最后那条行动），后面接整理要求。ctx 的原文到头部回合为止。"""
    assembled = ContextAssembler(prompts).assemble(
        replace(ctx, action=PlayerAction("text", "")), window
    )
    first_seq = ctx.history[0].seq if ctx.history else 0
    instruction = prompts.render(
        "compressor",
        first_seq=first_seq,
        last_seq=last_seq,
        has_synopsis=bool(ctx.memory.synopsis),
        protagonist=sanitize_for_fence(ctx.protagonist_name),
        # 中文、日文按字数，英文按词数
        limits={"chars": SYNOPSIS_CHARS, "words": SYNOPSIS_WORDS},
    )
    return [
        *assembled.messages[:-1],
        Message(role="user", content=instruction.text),
    ], instruction.hash


def parse_synopsis(text: str) -> tuple[str, bool]:
    """取 <synopsis> 里的文字；没写结束标签时取开始标签之后的全部，没有标签时取全文。
    返回（梗概，是否没写完）。"""
    body = text
    start = body.find("<synopsis>")
    if start >= 0:
        body = body[start + len("<synopsis>") :]
    end = body.find("</synopsis>")
    truncated = start >= 0 and end < 0
    if end >= 0:
        body = body[:end]
    return body.strip()[:SYNOPSIS_LIMIT], truncated


async def compress(
    route: ResolvedRoute,
    adapter: ProviderAdapter,
    ctx: TurnContext,
    last_seq: int,
    prompts: PromptLibrary,
    *,
    window: int,
    steps: StepLog,
    negative_cache: NegativeCapabilityCache | None = None,
) -> Compressed:
    del negative_cache  # 和其他 agent 的签名一致；这里没有要降级的能力
    messages, prompt_hash = compress_messages(ctx, last_seq, prompts, window)
    caps = route.caps

    async def call(
        history: Sequence[Message], _tools: Sequence[ToolSpec] | None
    ) -> ModelReply[ChatResult]:
        request = ChatRequest(
            messages=list(history),
            model=route.model,
            max_tokens=max(route.max_tokens, MIN_OUTPUT_TOKENS),
            temperature=route.temperature,
            # 推理只会多花钱：能关就关
            reasoning=ReasoningConfig(enabled=False) if caps.reasoning.control != "none" else None,
        )
        args = {"model": route.model, "last_seq": last_seq}
        started = time.perf_counter()
        try:
            result = await adapter.complete(request, route.credential, caps)
        except ProviderError as exc:
            steps.model(
                args=args,
                result={"error": exc.error_class.value, "status": exc.status},
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
            raise
        steps.model(
            args=args,
            result={"text": clip_text(result.text), "finish_reason": result.finish_reason},
            latency_ms=int((time.perf_counter() - started) * 1000),
            usage=result.usage,
        )
        return ModelReply(value=result, text=result.text)

    result = await run_agent(SPEC, messages, call, steps=steps, prompts=prompts)
    synopsis, truncated = parse_synopsis(result.text)
    if not synopsis:
        raise EmptySynopsis("The model wrote no synopsis")
    return Compressed(synopsis=synopsis, prompt_hash=prompt_hash, truncated=truncated)
