"""OpenAI 兼容协议的通用适配器。DeepSeek、Hugging Face、自定义端点以及以后新增的兼容厂商共用它，
差异只落在 profile 的钩子里。
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Any

import httpx

from .base import (
    ChatEvent,
    ChatRequest,
    ChatResult,
    Done,
    ForcedTool,
    Message,
    ModelInfo,
    ReasoningDelta,
    ResolvedCredential,
    TextDelta,
    ToolCall,
    ToolCallDelta,
    UsageEvent,
)
from .cancel import CancelToken, await_or_cancel
from .capabilities import Capabilities
from .errors import (
    ErrorClass,
    ProviderError,
    classify_exception,
    classify_http_error,
    classify_stream_error,
)
from .profile import ProviderProfile
from .sse_parser import SseDecoder, SseEvent, SseLineTooLong

# 用户的 extra_body 不能覆盖这些键；extra_headers 不能覆盖这些头
PROTECTED_BODY_KEYS = frozenset({"messages", "stream", "stream_options"})
PROTECTED_HEADERS = frozenset({"authorization", "host", "content-length", "transfer-encoding"})

MAX_ERROR_BODY = 64 * 1024
_THINK_RE = re.compile(r"^\s*<think>(.*?)</think>\s*", re.DOTALL | re.IGNORECASE)


def merge_extra_body(body: dict[str, Any], *layers: Mapping[str, Any] | None) -> dict[str, Any]:
    """把用户配置的请求体字段合并进去：映射递归合并，值为 None 表示删除该键。"""

    def merge(target: dict[str, Any], extra: Mapping[str, Any], top: bool) -> None:
        for key, value in extra.items():
            if top and key in PROTECTED_BODY_KEYS:
                continue
            if value is None:
                target.pop(key, None)
            elif isinstance(value, Mapping) and isinstance(target.get(key), dict):
                merge(target[key], value, top=False)
            else:
                target[key] = _plain(value)

    for layer in layers:
        if layer:
            merge(body, layer, top=True)
    return body


def _plain(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {k: _plain(v) for k, v in value.items() if v is not None}
    if isinstance(value, list | tuple):
        return [_plain(v) for v in value]
    return value


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, Mapping) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    return ""


def split_think(text: str) -> tuple[str, str]:
    """有些后端把推理放在正文开头的 <think>…</think> 里；拆成 (推理, 正文)。"""
    match = _THINK_RE.match(text)
    if not match:
        return "", text
    return match.group(1).strip(), text[match.end() :]


@dataclass
class _StreamState:
    emitted: bool = False
    saw_done_marker: bool = False
    finish_reason: str | None = None


class OpenAICompatAdapter:
    def __init__(
        self,
        profile: ProviderProfile,
        client: httpx.AsyncClient,
        *,
        total_timeout: float = 120.0,
        max_response_bytes: int = 16 * 1024 * 1024,
        max_sse_line_bytes: int = 1024 * 1024,
    ) -> None:
        self._profile = profile
        self._client = client
        self._total_timeout = total_timeout
        self._max_response_bytes = max_response_bytes
        self._max_sse_line_bytes = max_sse_line_bytes

    @property
    def profile(self) -> ProviderProfile:
        return self._profile

    # ---- 请求体 ---------------------------------------------------------------

    def build_body(
        self,
        req: ChatRequest,
        caps: Capabilities,
        *,
        stream: bool,
        cred_extra_body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """纯函数：同样的输入产出同样的请求体，便于单测和契约测试。"""
        with_tools = bool(req.tools)
        body: dict[str, Any] = {
            "model": req.model,
            "messages": [self._serialize(m, caps, with_tools) for m in req.messages],
            "max_tokens": req.max_tokens,
        }
        thinking = req.reasoning is not None and req.reasoning.enabled
        sampling_allowed = not thinking or caps.sampling.temperature_when_thinking
        if req.temperature is not None and caps.sampling.temperature and sampling_allowed:
            body["temperature"] = req.temperature
        if req.top_p is not None and caps.sampling.top_p and sampling_allowed:
            body["top_p"] = req.top_p
        if req.stop:
            body["stop"] = list(req.stop)
        fmt = req.response_format
        if fmt is not None and fmt.type == "json_object":
            body["response_format"] = {"type": "json_object"}
        elif fmt is not None and fmt.type == "json_schema":
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": fmt.name,
                    "schema": _plain(fmt.schema or {}),
                    "strict": fmt.strict,
                },
            }
        if req.tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": _plain(tool.parameters),
                    },
                }
                for tool in req.tools
            ]
        if isinstance(req.tool_choice, ForcedTool):
            body["tool_choice"] = {"type": "function", "function": {"name": req.tool_choice.name}}
        elif req.tool_choice is not None:
            body["tool_choice"] = req.tool_choice
        if stream:
            body["stream"] = True
            if caps.stream_usage:
                body["stream_options"] = {"include_usage": True}
        body = self._profile.prepare_body(body, req, caps)
        return merge_extra_body(body, cred_extra_body, req.extra_body)

    @staticmethod
    def _serialize(message: Message, caps: Capabilities, with_tools: bool) -> dict[str, Any]:
        data: dict[str, Any] = {"role": message.role, "content": message.content}
        if message.name:
            data["name"] = message.name
        if message.tool_calls:
            data["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": call.arguments},
                }
                for call in message.tool_calls
            ]
        if message.tool_call_id:
            data["tool_call_id"] = message.tool_call_id
        if (
            message.role == "assistant"
            and message.reasoning_content
            and with_tools
            and caps.echo_reasoning_with_tools
        ):
            data["reasoning_content"] = message.reasoning_content
        return data

    def _headers(self, cred: ResolvedCredential, *, stream: bool) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
        }
        for key, value in cred.extra_headers.items():
            if key.lower() not in PROTECTED_HEADERS:
                headers[key] = value
        headers.update(self._profile.auth_headers(cred))
        return headers

    def _url(self, cred: ResolvedCredential, path: str) -> str:
        try:
            return self._profile.base_url(cred) + path
        except ValueError as exc:
            raise ProviderError(
                ErrorClass.ENDPOINT_NOT_ALLOWED, str(exc), provider=self._profile.id
            ) from exc

    # ---- 流式 -----------------------------------------------------------------

    async def stream(
        self,
        req: ChatRequest,
        cred: ResolvedCredential,
        caps: Capabilities,
        *,
        cancel: CancelToken | None = None,
    ) -> AsyncIterator[ChatEvent]:
        body = self.build_body(req, caps, stream=True, cred_extra_body=cred.extra_body)
        url = self._url(cred, self._profile.chat_path)
        state = _StreamState()
        response: httpx.Response | None = None
        try:
            if cancel is not None:
                cancel.raise_if_cancelled()
            request = self._client.build_request(
                "POST", url, json=body, headers=self._headers(cred, stream=True)
            )
            # 等响应头也要能被取消：上游排队时首包可能要好几秒
            response = await await_or_cancel(self._client.send(request, stream=True), cancel)
            if response.status_code >= 300:
                raw = await await_or_cancel(
                    self._read_limited(response, MAX_ERROR_BODY, truncate=True), cancel
                )
                raise classify_http_error(
                    response.status_code,
                    raw,
                    response.headers,
                    provider=self._profile.id,
                    model=req.model,
                )
            content_type = response.headers.get("content-type", "").lower()
            if "text/event-stream" not in content_type and "json" in content_type:
                # 后端忽略了 stream=true，直接返回完整结果
                raw = await await_or_cancel(
                    self._read_limited(response, self._max_response_bytes), cancel
                )
                result = self._parse_completion(self._load_json(raw, req.model), req.model)
                for event in _result_events(result):
                    yield event
                return
            decoder = SseDecoder(self._max_sse_line_bytes)
            iterator = response.aiter_bytes().__aiter__()
            while not state.saw_done_marker:
                try:
                    chunk = await await_or_cancel(iterator.__anext__(), cancel)
                except StopAsyncIteration:
                    for sse in decoder.flush():
                        for event in self._handle_sse(sse, state, req.model):
                            yield event
                    break
                try:
                    sse_events = decoder.feed(chunk)
                except SseLineTooLong as exc:
                    raise ProviderError(
                        ErrorClass.INVALID_RESPONSE,
                        str(exc),
                        provider=self._profile.id,
                        model=req.model,
                        partial=state.emitted,
                    ) from exc
                for sse in sse_events:
                    for event in self._handle_sse(sse, state, req.model):
                        yield event
                    if state.saw_done_marker:
                        break
            if not state.saw_done_marker and state.finish_reason is None:
                raise ProviderError(
                    ErrorClass.STREAM_INTERRUPTED,
                    "The stream ended before the done marker",
                    provider=self._profile.id,
                    model=req.model,
                    partial=state.emitted,
                )
            yield Done(state.finish_reason)
        except ProviderError as error:
            if state.emitted:
                error.partial = True
            raise
        except httpx.HTTPError as exc:
            raise classify_exception(
                exc, provider=self._profile.id, model=req.model, partial=state.emitted
            ) from exc
        finally:
            if response is not None:
                await response.aclose()

    def _handle_sse(self, sse: SseEvent, state: _StreamState, model: str) -> list[ChatEvent]:
        data = sse.data.strip()
        if not data:
            return []
        if data == "[DONE]":
            state.saw_done_marker = True
            return []
        try:
            payload = json.loads(data)
        except json.JSONDecodeError as exc:
            raise ProviderError(
                ErrorClass.INVALID_RESPONSE,
                "Couldn't parse a stream chunk",
                provider=self._profile.id,
                model=model,
                partial=state.emitted,
            ) from exc
        if not isinstance(payload, Mapping):
            return []
        if payload.get("error"):
            raise classify_stream_error(
                payload, provider=self._profile.id, model=model, partial=state.emitted
            )
        events: list[ChatEvent] = []
        choices = payload.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], Mapping):
            choice = choices[0]
            delta = choice.get("delta") or choice.get("message") or {}
            if isinstance(delta, Mapping):
                reasoning = self._profile.parse_reasoning(delta)
                if reasoning:
                    events.append(ReasoningDelta(reasoning))
                text = _content_text(delta.get("content"))
                if text:
                    state.emitted = True
                    events.append(TextDelta(text))
                for item in delta.get("tool_calls") or ():
                    if not isinstance(item, Mapping):
                        continue
                    function = item.get("function") or {}
                    state.emitted = True
                    events.append(
                        ToolCallDelta(
                            index=int(item.get("index") or 0),
                            id=item.get("id"),
                            name=function.get("name"),
                            arguments=function.get("arguments") or "",
                        )
                    )
            finish = choice.get("finish_reason")
            if isinstance(finish, str) and finish:
                state.finish_reason = finish
        usage = self._profile.parse_usage(payload.get("usage"))
        if usage is not None:
            events.append(UsageEvent(usage))
        return events

    # ---- 非流式 ---------------------------------------------------------------

    async def complete(
        self,
        req: ChatRequest,
        cred: ResolvedCredential,
        caps: Capabilities,
        *,
        cancel: CancelToken | None = None,
    ) -> ChatResult:
        body = self.build_body(req, caps, stream=False, cred_extra_body=cred.extra_body)
        url = self._url(cred, self._profile.chat_path)

        async def call() -> ChatResult:
            async with self._client.stream(
                "POST", url, json=body, headers=self._headers(cred, stream=False)
            ) as response:
                if response.status_code >= 300:
                    raw = await self._read_limited(response, MAX_ERROR_BODY, truncate=True)
                    raise classify_http_error(
                        response.status_code,
                        raw,
                        response.headers,
                        provider=self._profile.id,
                        model=req.model,
                    )
                raw = await self._read_limited(response, self._max_response_bytes)
            return self._parse_completion(self._load_json(raw, req.model), req.model)

        try:
            if cancel is not None:
                cancel.raise_if_cancelled()
            async with asyncio.timeout(self._total_timeout if self._total_timeout > 0 else None):
                return await await_or_cancel(call(), cancel)
        except TimeoutError as exc:
            raise ProviderError(
                ErrorClass.TIMEOUT,
                f"The request took longer than {self._total_timeout:g} s in total",
                provider=self._profile.id,
                model=req.model,
            ) from exc
        except httpx.HTTPError as exc:
            raise classify_exception(exc, provider=self._profile.id, model=req.model) from exc

    def _load_json(self, raw: bytes, model: str) -> Mapping[str, Any]:
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ProviderError(
                ErrorClass.INVALID_RESPONSE,
                "The response isn't valid JSON",
                provider=self._profile.id,
                model=model,
            ) from exc
        if not isinstance(payload, Mapping):
            raise ProviderError(
                ErrorClass.INVALID_RESPONSE,
                "The response isn't a JSON object",
                provider=self._profile.id,
                model=model,
            )
        return payload

    def _parse_completion(self, payload: Mapping[str, Any], model: str) -> ChatResult:
        if payload.get("error"):
            raise classify_stream_error(payload, provider=self._profile.id, model=model)
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], Mapping):
            raise ProviderError(
                ErrorClass.INVALID_RESPONSE,
                "The response has no choices",
                provider=self._profile.id,
                model=model,
            )
        choice = choices[0]
        message = choice.get("message") or {}
        if not isinstance(message, Mapping):
            message = {}
        reasoning = self._profile.parse_reasoning(message) or ""
        think, text = split_think(_content_text(message.get("content")))
        if think and not reasoning:
            reasoning = think
        tool_calls: list[ToolCall] = []
        for item in message.get("tool_calls") or ():
            if isinstance(item, Mapping):
                function = item.get("function") or {}
                tool_calls.append(
                    ToolCall(
                        id=str(item.get("id") or ""),
                        name=str(function.get("name") or ""),
                        arguments=str(function.get("arguments") or ""),
                    )
                )
        finish = choice.get("finish_reason")
        return ChatResult(
            text=text,
            reasoning=reasoning,
            tool_calls=tuple(tool_calls),
            finish_reason=finish if isinstance(finish, str) else None,
            usage=self._profile.parse_usage(payload.get("usage")),
        )

    # ---- 模型列表 -------------------------------------------------------------

    async def list_models(self, cred: ResolvedCredential) -> list[ModelInfo]:
        url = self._url(cred, self._profile.models_path)
        headers = self._headers(cred, stream=False)
        headers.pop("Content-Type", None)
        try:
            async with self._client.stream("GET", url, headers=headers) as response:
                if response.status_code >= 300:
                    raw = await self._read_limited(response, MAX_ERROR_BODY, truncate=True)
                    raise classify_http_error(
                        response.status_code, raw, response.headers, provider=self._profile.id
                    )
                raw = await self._read_limited(response, self._max_response_bytes)
        except httpx.HTTPError as exc:
            raise classify_exception(exc, provider=self._profile.id) from exc
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ProviderError(
                ErrorClass.INVALID_RESPONSE,
                "The model list isn't valid JSON",
                provider=self._profile.id,
            ) from exc
        items = payload.get("data") if isinstance(payload, Mapping) else payload
        models: list[ModelInfo] = []
        for item in items if isinstance(items, list) else []:
            if isinstance(item, Mapping):
                info = self._profile.parse_model(item)
                if info is not None:
                    models.append(info)
        return sorted(models, key=lambda m: m.id)

    # ---- 工具 -----------------------------------------------------------------

    async def _read_limited(
        self, response: httpx.Response, limit: int, *, truncate: bool = False
    ) -> bytes:
        data = bytearray()
        async for chunk in response.aiter_bytes():
            data += chunk
            if len(data) > limit:
                if truncate:
                    return bytes(data[:limit])
                raise ProviderError(
                    ErrorClass.INVALID_RESPONSE,
                    f"The response exceeds the {limit // (1024 * 1024)} MB limit",
                    provider=self._profile.id,
                )
        return bytes(data)


def _result_events(result: ChatResult) -> list[ChatEvent]:
    events: list[ChatEvent] = []
    if result.reasoning:
        events.append(ReasoningDelta(result.reasoning))
    if result.text:
        events.append(TextDelta(result.text))
    for index, call in enumerate(result.tool_calls):
        events.append(
            ToolCallDelta(index=index, id=call.id, name=call.name, arguments=call.arguments)
        )
    if result.usage is not None:
        events.append(UsageEvent(result.usage))
    events.append(Done(result.finish_reason))
    return events


__all__ = ["OpenAICompatAdapter", "merge_extra_body", "split_think"]
