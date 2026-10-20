"""一次导演调用的流式部分（TurnRunner 用）：领这把密钥的请求名额、开流、边收边解析、
攒一下再推送叙述。出错不在这里重试，直接交给 TurnRunner 按失败处理。

两道保险，防止模型（或者玩家填的、不守规矩的接口）一直写下去：从开流算起的总时长上限，
和按 max_tokens 换算的总字数上限。碰到任何一条就主动停下，这一轮按失败结束，已写出的部分存成草稿。

日志：provider.request（开流）、provider.first_token、provider.response（成功结束，带 token 数）、
provider.failed、provider.slot_wait / slot_timeout（等并发槽位）、
provider.limit_hit（碰到总时长或总字数上限）。
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import structlog

from bettertavern.providers import (
    CancelToken,
    Done,
    ProviderError,
    ProviderHub,
    TextDelta,
    Usage,
    UsageEvent,
)
from bettertavern.providers.errors import ErrorClass
from bettertavern.providers.limiter import LimiterTimeout

from .agents.director import director_request
from .context.assembler import AssembledContext
from .ports import TurnFailure
from .protocol.director_parser import DirectorParse, DirectorStreamParser
from .routing import ResolvedRoute

log = structlog.get_logger(__name__)

# 推送一条回合事件给客户端：(事件名, 数据)
Publish = Callable[[str, dict[str, Any]], Awaitable[None]]

# 叙述的总字数上限 = max_tokens × 这个数。一个 token 英文约 4 个字符、中文 1 到 2 个字，
# 按 8 算足够宽松：守规矩的模型写到 max_tokens 就停了，碰不到它。只数正文，不数思考过程
CHARS_PER_TOKEN_CAP = 8

# provider 错误类别 → 回合失败码与能否重试
_FAILURE_CODES: dict[ErrorClass, tuple[str, bool]] = {
    ErrorClass.AUTH: ("CREDENTIAL_INVALID", False),
    ErrorClass.BILLING: ("PROVIDER_ERROR", False),
    ErrorClass.MODEL_NOT_FOUND: ("MODEL_NOT_FOUND", False),
    ErrorClass.CONTENT_POLICY_BLOCKED: ("CONTENT_BLOCKED", False),
    ErrorClass.ENDPOINT_NOT_ALLOWED: ("ENDPOINT_NOT_ALLOWED", False),
    ErrorClass.FORMAT_ERROR: ("PROVIDER_ERROR", False),
    ErrorClass.UNSUPPORTED_FEATURE: ("PROVIDER_ERROR", False),
    ErrorClass.CONTEXT_OVERFLOW: ("CONTEXT_TOO_LARGE", False),
    ErrorClass.PAYLOAD_TOO_LARGE: ("CONTEXT_TOO_LARGE", False),
    ErrorClass.CANCELLED: ("CANCELLED", True),
}


@dataclass
class Generation:
    """一次导演调用的流式结果。"""

    parse: DirectorParse
    streamed: str
    usage: Usage | None
    finish_reason: str | None
    ttft_ms: int | None
    route: ResolvedRoute
    context: AssembledContext
    latency_ms: int = 0


def failure_from_provider(error: ProviderError, narrative: str = "") -> TurnFailure:
    code, retryable = _FAILURE_CODES.get(error.error_class, ("PROVIDER_ERROR", True))
    if error.error_class not in _FAILURE_CODES:
        retryable = True  # 网络、限流、5xx 等：玩家点重试即可
    return TurnFailure(
        code=code,
        message=_friendly(error),
        retryable=retryable,
        partial=bool(narrative),
        narrative=narrative,
        reason=error.error_class.value,
    )


def _friendly(error: ProviderError) -> str:
    messages = {
        ErrorClass.AUTH: "The model provider rejected your key. Check the API key in Settings",
        ErrorClass.BILLING: (
            "The model provider says you're out of credit or have an unpaid balance"
        ),
        ErrorClass.RATE_LIMIT: "The model provider is rate-limiting you, please try again shortly",
        ErrorClass.OVERLOADED: "The model service is busy, please try again shortly",
        ErrorClass.MODEL_NOT_FOUND: "This model wasn't found. Check the model name",
        ErrorClass.CONTENT_POLICY_BLOCKED: "The provider's content policy blocked this part",
        ErrorClass.CONTEXT_OVERFLOW: (
            "The context doesn't fit in the model's window; try a model with a larger window"
        ),
        ErrorClass.STREAM_INTERRUPTED: "The connection dropped while writing",
        ErrorClass.CANCELLED: "Generation cancelled",
    }
    return messages.get(
        error.error_class, f"The model service ran into a problem: {error.error_class.value}"
    )


class StreamFailed(Exception):
    def __init__(self, error: ProviderError, streamed: str) -> None:
        super().__init__(error.message)
        self.error = error
        self.streamed = streamed


class GenerationLimitHit(Exception):
    """这一段超过了总时长或总字数上限，主动停下了。不重试。"""

    def __init__(self, failure: TurnFailure) -> None:
        super().__init__(failure.message)
        self.failure = failure


def _duration_text(seconds: float) -> str:
    if seconds >= 60 and seconds % 60 == 0:
        minutes = int(seconds // 60)
        return f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"
    return f"{seconds:g} seconds"


def limit_failure(reason: str, narrative: str, *, max_duration_s: float) -> TurnFailure:
    """reason：timeout（总时长）或 too_long（总字数）"""
    if reason == "timeout":
        code = "GENERATION_TIMEOUT"
        message = (
            f"This part was still unfinished after {_duration_text(max_duration_s)} and was "
            "stopped. Retry, or switch models"
        )
    else:
        code = "OUTPUT_TOO_LONG"
        message = (
            "The model kept writing past the length limit and was stopped. Retry, or switch models"
        )
    return TurnFailure(
        code=code, message=message, retryable=True, partial=bool(narrative), narrative=narrative
    )


def usage_json(usage: Usage | None) -> dict[str, int] | None:
    if usage is None:
        return None
    return {
        "prompt": usage.prompt,
        "completion": usage.completion,
        "cached": usage.cached,
        "reasoning": usage.reasoning,
    }


class DirectorStreamer:
    def __init__(
        self,
        hub: ProviderHub,
        *,
        clock: Callable[[], float],
        delta_batch_s: float,
        limiter_timeout_s: float,
        max_duration_s: float,
    ) -> None:
        self._hub = hub
        self._clock = clock
        self._delta_batch_s = delta_batch_s
        self._limiter_timeout_s = limiter_timeout_s
        self._max_duration_s = max_duration_s

    def _elapsed_ms(self, started: float) -> int:
        return int((self._clock() - started) * 1000)

    async def stream(
        self,
        route: ResolvedRoute,
        context: AssembledContext,
        publish: Publish,
        cancel: CancelToken,
    ) -> Generation:
        adapter = self._hub.adapter(route.provider)
        request = director_request(context, route)
        parser = DirectorStreamParser()
        pending: list[str] = []
        streamed: list[str] = []
        usage: Usage | None = None
        finish_reason: str | None = None
        ttft_ms: int | None = None
        started = self._clock()
        last_flush = started
        narrative_done = False
        max_chars = max(route.max_tokens, 1) * CHARS_PER_TOKEN_CAP
        received = 0
        limit: str | None = None  # 碰到了哪条上限：timeout / too_long

        async def flush() -> None:
            nonlocal last_flush
            if pending:
                text = "".join(pending)
                pending.clear()
                streamed.append(text)
                await publish("narrative.delta", {"text": text})
            last_flush = self._clock()

        try:
            async with self._hub.limiter.slot(
                route.credential.credential_id,
                interactive=True,
                timeout=self._limiter_timeout_s,
            ):
                waited = self._elapsed_ms(started)
                if waited >= 100:
                    # 同一个密钥的并发槽位满了，或者处于限流冷却
                    log.info("provider.slot_wait", duration_ms=waited)
                log.info(
                    "provider.request",
                    provider=route.provider,
                    model=route.model,
                    route_id=route.route_id,
                    estimated_tokens=context.estimated_tokens,
                )
                # 总时长从开流算起，等请求名额的时间不算在内
                deadline = asyncio.timeout(self._max_duration_s)
                try:
                    async with (
                        deadline,
                        # 提前跳出时立刻关掉流，不等垃圾回收，连接马上断开
                        contextlib.aclosing(
                            adapter.stream(request, route.credential, route.caps, cancel=cancel)
                        ) as events,
                    ):
                        async for event in events:
                            if isinstance(event, TextDelta):
                                if ttft_ms is None:
                                    ttft_ms = int((self._clock() - started) * 1000)
                                    log.info("provider.first_token", ttft_ms=ttft_ms)
                                received += len(event.text)
                                if received > max_chars:
                                    limit = "too_long"
                                    break
                                pending.extend(parser.feed(event.text))
                                if pending and self._clock() - last_flush >= self._delta_batch_s:
                                    await flush()
                                if parser.narrative_closed and not narrative_done:
                                    await flush()
                                    narrative_done = True
                                    await publish(
                                        "narrative.done", {"chars": len("".join(streamed))}
                                    )
                            elif isinstance(event, UsageEvent):
                                usage = event.usage
                            elif isinstance(event, Done):
                                finish_reason = event.finish_reason
                except TimeoutError:
                    if not deadline.expired():
                        raise
                    limit = "timeout"
        except LimiterTimeout as exc:
            log.warning("provider.slot_timeout", duration_ms=self._elapsed_ms(started))
            raise StreamFailed(
                ProviderError(
                    ErrorClass.RATE_LIMIT, "Timed out waiting for a model concurrency slot"
                ),
                "",
            ) from exc
        except ProviderError as exc:
            await flush()
            log.warning(
                "provider.failed",
                provider=route.provider,
                model=route.model,
                error_class=exc.error_class.value,
                status=exc.status,
                partial=bool(streamed),
                streamed_chars=len("".join(streamed)),
                duration_ms=self._elapsed_ms(started),
            )
            raise StreamFailed(exc, "".join(streamed)) from exc
        if limit is not None:
            await flush()
            narrative = "".join(streamed)
            log.warning(
                "provider.limit_hit",
                provider=route.provider,
                model=route.model,
                reason=limit,
                max_duration_s=self._max_duration_s,
                max_chars=max_chars,
                streamed_chars=len(narrative),
                duration_ms=self._elapsed_ms(started),
            )
            raise GenerationLimitHit(
                limit_failure(limit, narrative, max_duration_s=self._max_duration_s)
            )
        log.info(
            "provider.response",
            provider=route.provider,
            model=route.model,
            ttft_ms=ttft_ms,
            duration_ms=self._elapsed_ms(started),
            finish_reason=finish_reason,
            prompt_tokens=usage.prompt if usage else None,
            cached_tokens=usage.cached if usage else None,
            completion_tokens=usage.completion if usage else None,
            reasoning_tokens=usage.reasoning if usage else None,
            streamed_chars=len("".join(streamed)),
        )
        tail, parse = parser.finish()
        pending.extend(tail)
        await flush()
        if not narrative_done:
            await publish(
                "narrative.done",
                {"chars": len(parse.narrative), "rewritten": parse.rewritten},
            )
        return Generation(
            parse=parse,
            streamed="".join(streamed),
            usage=usage,
            finish_reason=finish_reason,
            ttft_ms=ttft_ms,
            route=route,
            context=context,
            latency_ms=self._elapsed_ms(started),
        )
