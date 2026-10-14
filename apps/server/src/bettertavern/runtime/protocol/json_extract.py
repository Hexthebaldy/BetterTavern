"""宽松提取模型输出里的 JSON 对象：去掉 markdown 围栏，取第一个完整的对象。

输出来自外部模型（自定义端点可以返回任意内容），所以耗时必须与长度大致成线性：
在每个 "{" 处用 C 实现的 raw_decode 试解析，失败就跳到下一个 "{"，并限制长度和尝试次数。
"""

from __future__ import annotations

import json
import re
from typing import Any

_FENCED_JSON = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_DECODER = json.JSONDecoder()
MAX_SCAN_CHARS = 512 * 1024
MAX_ATTEMPTS = 2_000


def extract_json_object(text: str) -> dict[str, Any] | None:
    """宽松提取：去掉 markdown 围栏，取第一个完整的 JSON 对象。"""
    fenced = _FENCED_JSON.search(text)
    candidate = (fenced.group(1) if fenced else text)[:MAX_SCAN_CHARS]
    start = candidate.find("{")
    attempts = 0
    while start != -1 and attempts < MAX_ATTEMPTS:
        attempts += 1
        try:
            value, _end = _DECODER.raw_decode(candidate, start)
        except (json.JSONDecodeError, RecursionError):
            value = None
        if isinstance(value, dict):
            return value
        start = candidate.find("{", start + 1)
    return None
