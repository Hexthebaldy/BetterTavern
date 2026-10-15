"""与厂商无关的请求、响应和流式事件类型。

provider 层是 runtime 里唯一访问外部模型服务的地方；它不 import 本项目的其他包。
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal, Protocol

if TYPE_CHECKING:
    from .cancel import CancelToken
    from .capabilities import Capabilities
    from .profile import ProviderProfile

Role = Literal["system", "user", "assistant", "tool"]


class Secret:
    """包住密钥，避免它出现在 repr、日志和异常信息里。"""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        self._value = value

    def reveal(self) -> str:
        return self._value

    def last4(self) -> str:
        return self._value[-4:] if len(self._value) >= 8 else ""

    def __repr__(self) -> str:
        return "Secret('****')"

    __str__ = __repr__

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Secret) and other._value == self._value

    def __hash__(self) -> int:
        return hash(self._value)

    def __bool__(self) -> bool:
        return bool(self._value)


@dataclass(frozen=True, slots=True)
class ToolCall:
    id: str
    name: str
    arguments: str  # 厂商返回的原始 JSON 字符串


@dataclass(frozen=True, slots=True)
class Message:
    role: Role
    content: str
    name: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str | None = None
    # 只在需要回传推理内容的厂商（DeepSeek 带工具时）才会被发出去
    reasoning_content: str | None = None


@dataclass(frozen=True, slots=True)
class ReasoningConfig:
    enabled: bool
    effort: str | None = None


@dataclass(frozen=True, slots=True)
class ResponseFormat:
    type: Literal["text", "json_object", "json_schema"]
    schema: Mapping[str, Any] | None = None
    name: str = "output"
    strict: bool = True


@dataclass(frozen=True, slots=True)
class ToolSpec:
    name: str
    description: str
    parameters: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class ForcedTool:
    """强制模型调用指定的函数。"""

    name: str


ToolChoice = Literal["auto", "none", "required"] | ForcedTool


@dataclass(frozen=True, slots=True)
class ChatRequest:
    messages: Sequence[Message]
    model: str
    max_tokens: int
    temperature: float | None = None
    top_p: float | None = None
    stop: Sequence[str] | None = None
    reasoning: ReasoningConfig | None = None
    response_format: ResponseFormat | None = None
    tools: Sequence[ToolSpec] | None = None
    tool_choice: ToolChoice | None = None
    # 路由级的自定义请求体字段；值为 None 表示删除该键
    extra_body: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Usage:
    prompt: int = 0
    completion: int = 0
    cached: int = 0
    reasoning: int = 0

    @property
    def total(self) -> int:
        return self.prompt + self.completion


@dataclass(frozen=True, slots=True)
class TextDelta:
    text: str


@dataclass(frozen=True, slots=True)
class ReasoningDelta:
    text: str


@dataclass(frozen=True, slots=True)
class ToolCallDelta:
    index: int
    id: str | None
    name: str | None
    arguments: str


@dataclass(frozen=True, slots=True)
class UsageEvent:
    usage: Usage


@dataclass(frozen=True, slots=True)
class Done:
    finish_reason: str | None


ChatEvent = TextDelta | ReasoningDelta | ToolCallDelta | UsageEvent | Done


@dataclass(frozen=True, slots=True)
class ChatResult:
    text: str
    reasoning: str
    tool_calls: tuple[ToolCall, ...]
    finish_reason: str | None
    usage: Usage | None


@dataclass(frozen=True, slots=True)
class ModelInfo:
    id: str
    context_window: int | None = None
    owned_by: str | None = None
    # 同一个模型由多家后端提供、窗口各不相同时（Hugging Face），每家后端的窗口
    backend_windows: Mapping[str, int] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ResolvedCredential:
    """解密后的凭据，只在 provider 层请求时存在，用完即弃。"""

    credential_id: str
    provider: str
    api_key: Secret
    base_url: str | None = None
    extra_headers: Mapping[str, str] = field(default_factory=dict)
    extra_body: Mapping[str, Any] = field(default_factory=dict)


class ProviderAdapter(Protocol):
    """一家厂商（或一类协议）的适配器。"""

    @property
    def profile(self) -> ProviderProfile: ...

    def build_body(
        self,
        req: ChatRequest,
        caps: Capabilities,
        *,
        stream: bool,
        cred_extra_body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]: ...

    def stream(
        self,
        req: ChatRequest,
        cred: ResolvedCredential,
        caps: Capabilities,
        *,
        cancel: CancelToken | None = None,
    ) -> AsyncIterator[ChatEvent]: ...

    async def complete(
        self,
        req: ChatRequest,
        cred: ResolvedCredential,
        caps: Capabilities,
        *,
        cancel: CancelToken | None = None,
    ) -> ChatResult: ...

    async def list_models(self, cred: ResolvedCredential) -> list[ModelInfo]: ...
