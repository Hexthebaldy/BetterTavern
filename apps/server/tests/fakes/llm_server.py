"""假 LLM 服务：模拟 OpenAI 兼容的接口，按脚本回复，可以注入故障。

集成测试、端到端测试和评测脚本的离线模式共用它。脚本是一个回复队列，每来一个
/chat/completions 请求就取出一个回复；/models 返回配置好的模型列表。

可注入的故障：任意状态码与错误体、Retry-After、流中途断开、流里的错误块、慢首 token、
keep-alive 注释、多字节字符被拆在两个 chunk 里、标签损坏（直接写进 content 即可）。
"""

from __future__ import annotations

import asyncio
import json
from collections import deque
from collections.abc import Awaitable, Callable, Iterable, Mapping, MutableMapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from tests.fakes.asgi_server import AsgiServer

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


@dataclass(frozen=True)
class RecordedRequest:
    method: str
    path: str
    headers: dict[str, str]
    body: Any


@dataclass
class JsonReply:
    body: Any
    status: int = 200
    headers: Mapping[str, str] = field(default_factory=dict)
    headers_delay: float = 0.0  # 先等这么久再发响应头（模拟上游排队）

    async def send(self, send: Send) -> None:
        payload = json.dumps(self.body, ensure_ascii=False).encode()
        if self.headers_delay:
            await asyncio.sleep(self.headers_delay)
        await _start(send, self.status, "application/json", self.headers)
        await send({"type": "http.response.body", "body": payload, "more_body": False})


@dataclass
class StreamReply:
    """items 里的 bytes 原样发出，float 表示先等这么多秒。"""

    items: list[bytes | float]
    status: int = 200
    headers: Mapping[str, str] = field(default_factory=dict)
    content_type: str = "text/event-stream"
    disconnect: bool = False  # True：不发结束块就返回，客户端会看到连接中途断开
    headers_delay: float = 0.0  # 先等这么久再发响应头（模拟上游排队）

    async def send(self, send: Send) -> None:
        if self.headers_delay:
            await asyncio.sleep(self.headers_delay)
        await _start(send, self.status, self.content_type, self.headers)
        for item in self.items:
            if isinstance(item, float):
                await asyncio.sleep(item)
            else:
                await send({"type": "http.response.body", "body": item, "more_body": True})
        if not self.disconnect:
            await send({"type": "http.response.body", "body": b"", "more_body": False})


Reply = JsonReply | StreamReply


async def _start(send: Send, status: int, content_type: str, headers: Mapping[str, str]) -> None:
    raw = [(b"content-type", content_type.encode())]
    raw += [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    await send({"type": "http.response.start", "status": status, "headers": raw})


# ---- 构造 OpenAI 风格数据块的小工具 -------------------------------------------


def chunk(
    content: str | None = None,
    *,
    reasoning: str | None = None,
    finish: str | None = None,
    usage: Mapping[str, Any] | None = None,
    tool_calls: Sequence[Mapping[str, Any]] | None = None,
    no_choices: bool = False,
) -> dict[str, Any]:
    delta: dict[str, Any] = {}
    if content is not None:
        delta["content"] = content
    if reasoning is not None:
        delta["reasoning_content"] = reasoning
    if tool_calls is not None:
        delta["tool_calls"] = list(tool_calls)
    payload: dict[str, Any] = {"id": "chatcmpl-fake", "object": "chat.completion.chunk"}
    payload["choices"] = (
        [] if no_choices else [{"index": 0, "delta": delta, "finish_reason": finish}]
    )
    if usage is not None:
        payload["usage"] = dict(usage)
    return payload


def sse(payload: Mapping[str, Any] | str) -> bytes:
    data = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return f"data: {data}\n\n".encode()


DONE = b"data: [DONE]\n\n"


def text_stream(
    pieces: Iterable[str],
    *,
    finish: str = "stop",
    usage: Mapping[str, Any] | None = None,
    reasoning: Iterable[str] = (),
    done: bool = True,
) -> list[bytes | float]:
    """把一串文字片段做成完整的流：推理块、正文块、结束块、usage 块、[DONE]。"""
    items: list[bytes | float] = [sse(chunk(reasoning=r)) for r in reasoning]
    items += [sse(chunk(p)) for p in pieces]
    items.append(sse(chunk(finish=finish)))
    if usage is not None:
        items.append(sse(chunk(usage=usage, no_choices=True)))
    if done:
        items.append(DONE)
    return items


def completion(
    content: str = "",
    *,
    reasoning: str | None = None,
    finish: str = "stop",
    usage: Mapping[str, Any] | None = None,
    tool_calls: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": content}
    if reasoning is not None:
        message["reasoning_content"] = reasoning
    if tool_calls is not None:
        message["tool_calls"] = list(tool_calls)
    return {
        "id": "chatcmpl-fake",
        "object": "chat.completion",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": dict(usage or {"prompt_tokens": 10, "completion_tokens": 5}),
    }


# ---- ASGI 应用 ----------------------------------------------------------------


class FakeLLM:
    def __init__(self) -> None:
        self.replies: deque[Reply] = deque()
        self.requests: list[RecordedRequest] = []
        self.models: list[dict[str, Any]] = [{"id": "fake-model", "object": "model"}]
        self.default_reply: Callable[[RecordedRequest], Reply] | None = None

    def push(self, *replies: Reply) -> None:
        self.replies.extend(replies)

    def reset(self) -> None:
        self.replies.clear()
        self.requests.clear()
        self.models = [{"id": "fake-model", "object": "model"}]
        self.default_reply = None

    @property
    def chat_requests(self) -> list[RecordedRequest]:
        return [r for r in self.requests if r.path.endswith("/chat/completions")]

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return
        body = bytearray()
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        try:
            parsed: Any = json.loads(body) if body else None
        except json.JSONDecodeError:
            parsed = body.decode(errors="replace")
        request = RecordedRequest(scope["method"], scope["path"], headers, parsed)
        self.requests.append(request)
        if scope["method"] == "GET" and scope["path"].endswith("/models"):
            reply: Reply = JsonReply({"object": "list", "data": self.models})
        elif self.replies:
            reply = self.replies.popleft()
        elif self.default_reply is not None:
            reply = self.default_reply(request)
        else:
            reply = JsonReply({"error": {"message": "fake server: no scripted reply"}}, status=500)
        await reply.send(send)


@dataclass
class RunningFakeLLM:
    app: FakeLLM
    host: str
    port: int

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}/v1"


class FakeLLMServer:
    """在后台线程里跑假 LLM 服务，测试结束时关闭。"""

    def __init__(self, app: FakeLLM | None = None) -> None:
        self.app = app or FakeLLM()
        self._server = AsgiServer(self.app)

    def start(self) -> RunningFakeLLM:
        self._server.start()
        return RunningFakeLLM(app=self.app, host="127.0.0.1", port=self._server.port)

    def stop(self) -> None:
        self._server.stop()
