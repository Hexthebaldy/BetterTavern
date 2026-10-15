"""日志脱敏：每条日志写出去之前，抹掉密钥和密码，丢掉故事文本，截断过长的值。

分三道关（思路参考 kimi-code 的 logging/formatter.ts 与 hermes-agent 的 redact.py）：

1. 看字段名。名字像密钥的字段（authorization、api_key、token、password……）整个值换成 [REDACTED]；
   名字是故事文本的字段（narrative、text、content……）整个丢掉，
   只有开发环境打开 LOG_STORY_TEXT 才保留。
   这些名字是约定：写日志时，故事文本只能放在这些字段里，别的字段不放故事文本。
2. 看内容。任何字符串里像密钥的片段（Bearer 令牌、sk-…、hf_…、JWT、api_key=…）抹掉，邮箱打码。
   异常信息、第三方库的日志也会经过这一关。
3. 看长度。事件名、字段值、异常堆栈各有上限，超出部分截掉，一条日志不会因为误塞了大段内容而撑爆。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

REDACTED = "[REDACTED]"

EVENT_MAX_CHARS = 300
VALUE_MAX_CHARS = 2000
EXCEPTION_MAX_CHARS = 8000
LIST_MAX_ITEMS = 50
MAX_DEPTH = 6

# 字段名去掉大小写和 _ - . 之后比较
_SECRET_KEYS = frozenset(
    {
        "authorization",
        "apikey",
        "xapikey",
        "key",
        "token",
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "password",
        "passwd",
        "newpassword",
        "oldpassword",
        "secret",
        "clientsecret",
        "authsecret",
        "masterkeys",
        "cookie",
        "setcookie",
        "bearer",
    }
)

# 故事文本只能放在这些字段里
STORY_KEYS = frozenset(
    {
        "narrative",
        "text",
        "content",
        "messages",
        "prompt",
        "completion",
        "story",
        "actiontext",
        "greeting",
        "firstmes",
        "persona",
        "description",
    }
)

_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 " + REDACTED),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"), REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"), "sk-" + REDACTED),
    (re.compile(r"\bhf_[A-Za-z0-9]{8,}"), "hf_" + REDACTED),
    (
        re.compile(
            r"(?i)\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)"
            r"\s*[:=]\s*)[\"']?[^\s\"'&,;]+"
        ),
        r"\1" + REDACTED,
    ),
    (re.compile(r"(?i)([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+"), r"\1" + REDACTED),
)
_EMAIL = re.compile(r"\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b")


def _normalize(key: str) -> str:
    return key.lower().replace("_", "").replace("-", "").replace(".", "")


def scrub_text(text: str, limit: int = VALUE_MAX_CHARS) -> str:
    """抹掉字符串里像密钥的片段、给邮箱打码，再按上限截断"""
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    text = _EMAIL.sub(r"\1***@\2", text)
    if len(text) > limit:
        text = f"{text[:limit]}…（截断，原长 {len(text)} 字）"
    return text


def _scrub_value(value: Any, *, keep_story: bool, depth: int) -> Any:
    if isinstance(value, str):
        return scrub_text(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if depth >= MAX_DEPTH:
        return "[REDACTED:太深]"
    if isinstance(value, Mapping):
        return _scrub_mapping(value, keep_story=keep_story, depth=depth + 1)
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        out = [
            _scrub_value(v, keep_story=keep_story, depth=depth + 1) for v in items[:LIST_MAX_ITEMS]
        ]
        if len(items) > LIST_MAX_ITEMS:
            out.append(f"…（另有 {len(items) - LIST_MAX_ITEMS} 项）")
        return out
    # 其他对象按文字处理：repr 里也可能带着密钥
    return scrub_text(str(value))


def _scrub_mapping(data: Mapping[Any, Any], *, keep_story: bool, depth: int) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for raw_key, value in data.items():
        key = str(raw_key)
        normalized = _normalize(key)
        if normalized in _SECRET_KEYS:
            out[key] = REDACTED
        elif normalized in STORY_KEYS and not keep_story:
            continue
        else:
            out[key] = _scrub_value(value, keep_story=keep_story, depth=depth)
    return out


def redact_event(event: Mapping[str, Any], *, keep_story: bool = False) -> dict[str, Any]:
    """处理一条日志：structlog 的 event_dict 进，脱敏后的新 dict 出（不改原来的）。
    下划线开头的是 structlog 自己的内部字段（例如原始的 LogRecord），原样保留，输出前它会自己去掉"""
    out = _scrub_mapping(
        {
            k: v
            for k, v in event.items()
            if k not in ("event", "exception") and not k.startswith("_")
        },
        keep_story=keep_story,
        depth=0,
    )
    if "event" in event:
        out["event"] = scrub_text(str(event["event"]), EVENT_MAX_CHARS)
    if "exception" in event:
        out["exception"] = scrub_text(str(event["exception"]), EXCEPTION_MAX_CHARS)
    out.update({k: v for k, v in event.items() if k.startswith("_")})
    return out


class Redactor:
    """structlog 的处理器：放在格式化异常之后、输出之前"""

    def __init__(self, *, keep_story: bool = False) -> None:
        self.keep_story = keep_story

    def __call__(
        self, logger: object, method: str, event_dict: Mapping[str, Any]
    ) -> dict[str, Any]:
        return redact_event(event_dict, keep_story=self.keep_story)
