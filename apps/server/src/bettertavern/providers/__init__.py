"""Provider 层：把与厂商无关的请求变成该厂商的 HTTP 请求，并把响应流还原成统一事件。

不含任何剧情逻辑，也是 runtime 里唯一允许访问外部模型服务的地方。
"""

from .base import (
    ChatEvent,
    ChatRequest,
    ChatResult,
    Done,
    ForcedTool,
    Message,
    ModelInfo,
    ProviderAdapter,
    ReasoningConfig,
    ReasoningDelta,
    ResolvedCredential,
    ResponseFormat,
    Secret,
    TextDelta,
    ToolCall,
    ToolCallDelta,
    ToolSpec,
    Usage,
    UsageEvent,
)
from .cancel import CancelToken
from .capabilities import Capabilities, NegativeCapabilityCache, resolve_capabilities
from .errors import EndpointNotAllowed, ErrorClass, ProviderError
from .hub import ProviderHub
from .limiter import CredentialLimiter, LimiterConfig, LimiterTimeout
from .message_transforms import TransformLevel, apply_transforms
from .probe import ProbeReport, probe_model
from .registry import ProviderRegistry, UnknownProvider, default_registry
from .retry import BACKGROUND, HOT_PATH, RetryPolicy, call_with_retry, stream_with_retry
from .transport import EndpointPolicy, validate_endpoint

__all__ = [
    "BACKGROUND",
    "HOT_PATH",
    "CancelToken",
    "Capabilities",
    "ChatEvent",
    "ChatRequest",
    "ChatResult",
    "CredentialLimiter",
    "Done",
    "EndpointNotAllowed",
    "EndpointPolicy",
    "ErrorClass",
    "ForcedTool",
    "LimiterConfig",
    "LimiterTimeout",
    "Message",
    "ModelInfo",
    "NegativeCapabilityCache",
    "ProbeReport",
    "ProviderAdapter",
    "ProviderError",
    "ProviderHub",
    "ProviderRegistry",
    "ReasoningConfig",
    "ReasoningDelta",
    "ResolvedCredential",
    "ResponseFormat",
    "RetryPolicy",
    "Secret",
    "TextDelta",
    "ToolCall",
    "ToolCallDelta",
    "ToolSpec",
    "TransformLevel",
    "UnknownProvider",
    "Usage",
    "UsageEvent",
    "apply_transforms",
    "call_with_retry",
    "default_registry",
    "probe_model",
    "resolve_capabilities",
    "stream_with_retry",
    "validate_endpoint",
]
