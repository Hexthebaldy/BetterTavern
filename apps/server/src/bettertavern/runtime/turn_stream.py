"""一次导演调用的流式部分（TurnRunner 用）：占并发槽位、带重试地开流、边收边解析、按批推送叙述增量。

两道保险，防止模型（或者玩家填的、不守规矩的接口）一直写下去：从开流算起的总时长上限，
和按 max_tokens 换算的总字数上限。碰到任何一条就主动停下，这一轮按失败结束，已写出的部分存成草稿。

日志：provider.request（每次开流）、provider.retry（首个可见内容之前出错后重试）、
provider.first_token、provider.response（成功结束，带 token 数）、provider.failed、
provider.slot_wait / slot_timeout（等并发槽位）、provider.limit_hit（碰到总时长或总字数上限）。
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import structlog

from bettertavern.providers import (
    HOT_PATH,
    CancelToken,
    Done,
    ProviderError,
    ProviderHub,
    TextDelta,
    Usage,
    UsageEvent,
    stream_with_retry,
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
    fallback_used: bool = False


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
    )


def _friendly(error: ProviderError) -> str:
    messages = {
        ErrorClass.AUTH: "模型服务商拒绝了你的密钥，请检查设置里的 API Key",
        ErrorClass.BILLING: "模型服务商提示额度不足或欠费",
        ErrorClass.RATE_LIMIT: "请求太频繁，被模型服务商限流了，请稍后重试",
        ErrorClass.OVERLOADED: "模型服务暂时繁忙，请稍后重试",
        ErrorClass.MODEL_NOT_FOUND: "找不到这个模型，请检查模型名",
        ErrorClass.CONTENT_POLICY_BLOCKED: "这段内容被模型服务商的内容策略拦截了",
        ErrorClass.CONTEXT_OVERFLOW: "上下文超出了模型窗口，建议换更大窗口的模型",
        ErrorClass.STREAM_INTERRUPTED: "生成中途断开了",
        ErrorClass.CANCELLED: "生成已取消",
    }
    return messages.get(error.error_class, f"模型服务出错：{error.error_class.value}")


class StreamFailed(Exception):
    def __init__(self, error: ProviderError, streamed: str) -> None:
        super().__init__(error.message)
        self.error = error
        self.streamed = streamed


class GenerationLimitHit(Exception):
    """这一段超过了总时长或总字数上限，主动停下了。不重试、不切备用模型。"""

    def __init__(self, failure: TurnFailure) -> None:
        super().__init__(failure.message)
        self.failure = failure


def _duration_text(seconds: float) -> str:
    if seconds >= 60 and seconds % 60 == 0:
        return f"{int(seconds // 60)} 分钟"
    return f"{seconds:g} 秒"


def limit_failure(reason: str, narrative: str, *, max_duration_s: float) -> TurnFailure:
    """reason：timeout（总时长）或 too_long（总字数）"""
    if reason == "timeout":
        code = "GENERATION_TIMEOUT"
        message = (
            f"这一段写了 {_duration_text(max_duration_s)}还没写完，已经停下。可以重试，或者换个模型"
        )
    else:
        code = "OUTPUT_TOO_LONG"
        message = "模型一直写个不停，超过了长度上限，已经停下。可以重试，或者换个模型"
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
        attempts = 0
        attempt_started = started
        max_chars = max(route.max_tokens, 1) * CHARS_PER_TOKEN_CAP
        received = 0
        limit: str | None = None  # 碰到了哪条上限：timeout / too_long

        def open_stream() -> Any:
            nonlocal attempts, attempt_started
            attempts += 1
            attempt_started = self._clock()
            log.info(
                "provider.request",
                provider=route.provider,
                model=route.model,
                route_id=route.route_id,
                attempt=attempts,
                estimated_tokens=context.estimated_tokens,
            )
            return adapter.stream(request, route.credential, route.caps, cancel=cancel)

        def on_retry(error: ProviderError, retries: int, delay: float) -> None:
            # 首个可见内容之前出错（429、超时、5xx……），退避后在同一路由上重试
            log.warning(
                "provider.retry",
                attempt=retries,
                error_class=error.error_class.value,
                status=error.status,
                retry_in_s=round(delay, 2),
                duration_ms=self._elapsed_ms(attempt_started),
            )

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
                # 总时长从开流算起（含首字之前的重试），等并发槽位的时间另算
                deadline = asyncio.timeout(self._max_duration_s)
                try:
                    async with (
                        deadline,
                        # 提前跳出时立刻关掉流，不等垃圾回收，连接马上断开
                        contextlib.aclosing(
                            stream_with_retry(open_stream, HOT_PATH, on_retry=on_retry)
                        ) as events,
                    ):
                        async for event in events:
                            if isinstance(event, TextDelta):
                                if ttft_ms is None:
                                    ttft_ms = int((self._clock() - started) * 1000)
                                    log.info(
                                        "provider.first_token", ttft_ms=ttft_ms, attempt=attempts
                                    )
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
                ProviderError(ErrorClass.RATE_LIMIT, "等待模型并发槽位超时"), ""
            ) from exc
        except ProviderError as exc:
            await flush()
            log.warning(
                "provider.failed",
                provider=route.provider,
                model=route.model,
                attempt=attempts,
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
            attempts=attempts,
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
