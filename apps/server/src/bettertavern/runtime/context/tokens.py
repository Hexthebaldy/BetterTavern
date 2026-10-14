"""token 估算：不依赖具体分词器的保守估计。

DeepSeek 与 Hugging Face 上的模型分词器各不相同，这里故意往高估：中日韩字符按 1 个 token 算，
其余按每 3.5 个字符 1 个 token。只用于预算与紧急截断；真实用量以厂商返回的 usage 为准，
以后用 provider 返回的 prompt_tokens 校准系数（docs/backend.md 第 4 节）。
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable

from bettertavern.providers import Message

_CJK = re.compile(r"[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]")
MESSAGE_OVERHEAD = 4


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    cjk = len(_CJK.findall(text))
    other = len(text) - cjk
    return cjk + math.ceil(other / 3.5)


def estimate_messages(messages: Iterable[Message]) -> int:
    return sum(estimate_tokens(m.content) + MESSAGE_OVERHEAD for m in messages) + 2
