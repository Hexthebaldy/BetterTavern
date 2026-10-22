"""网页正文的几样处理：地址里像 Key 的东西、内嵌的 base64 图片、超长正文的截取、按行读中间那段。"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlsplit

# 查询参数名像密钥、值又够长的；或者值本身长得像常见的 Key
_SECRET_PARAMS = {
    "key",
    "api_key",
    "apikey",
    "access_token",
    "token",
    "auth",
    "secret",
    "client_secret",
    "password",
    "passwd",
    "sig",
    "signature",
    "x-api-key",
}
_SECRET_VALUE = re.compile(
    r"(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}"
    r"|xox[abpr]-[A-Za-z0-9-]{10,}|tvly-[A-Za-z0-9]{16,})"
)
_DATA_IMAGE = re.compile(r"!\[([^\]]*)\]\(data:image/[^)]{20,}\)")
_RAW_DATA_IMAGE = re.compile(r"data:image/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=\s]{40,}")

HEAD_SHARE = 0.75


def secret_in_url(url: str) -> bool:
    """地址里带着像 API Key 的东西：整个请求拒绝，免得把别人的 Key 发出去或存进缓存。"""
    if _SECRET_VALUE.search(url):
        return True
    try:
        query = urlsplit(url).query
    except ValueError:
        return False
    for name, value in parse_qsl(query, keep_blank_values=False):
        if name.lower() in _SECRET_PARAMS and len(value) >= 16:
            return True
    return False


def strip_inline_images(text: str) -> str:
    """内嵌的 base64 图片换成 [IMAGE: 说明]，不把一大串乱码塞进上下文。"""
    text = _DATA_IMAGE.sub(lambda m: f"[IMAGE: {m.group(1) or 'image'}]", text)
    return _RAW_DATA_IMAGE.sub("[IMAGE]", text)


def looks_binary(sample: bytes) -> bool:
    """前 2 KB 里有 NUL，或者不可打印的字节占了一成以上：多半不是文字。"""
    head = sample[:2048]
    if not head:
        return False
    if b"\x00" in head:
        return True
    control = sum(1 for b in head if b < 9 or 13 < b < 32)
    return control / len(head) > 0.1


def clip_page(content: str, limit: int, *, page_id: str, more_hint: str) -> str:
    """超长的正文保留开头 75% 和结尾 25%，中间省略；末尾写明怎么按行读中间那段。
    more_hint 里有 {page_id}、{start}、{end}、{total} 几个占位。"""
    if len(content) <= limit:
        return content
    lines = content.split("\n")
    head_budget = int(limit * HEAD_SHARE)
    tail_budget = limit - head_budget
    head: list[str] = []
    used = 0
    for line in lines:
        if used + len(line) + 1 > head_budget:
            break
        head.append(line)
        used += len(line) + 1
    tail: list[str] = []
    used = 0
    for line in reversed(lines[len(head) :]):
        if used + len(line) + 1 > tail_budget:
            break
        tail.append(line)
        used += len(line) + 1
    tail.reverse()
    if not head:  # 一行就超长的页面：直接按字截
        head = [content[:head_budget]]
    start = len(head) + 1
    end = len(lines) - len(tail)
    hint = more_hint.format(page_id=page_id, start=start, end=end, total=len(lines))
    return "\n".join([*head, f"\n[……{hint}……]\n", *tail])


def read_lines(content: str, start: int, count: int) -> tuple[str, int]:
    """第 start 行起（从 1 开始）读 count 行，返回文字和总行数。"""
    lines = content.split("\n")
    start = max(start, 1)
    chunk = lines[start - 1 : start - 1 + max(count, 0)]
    return "\n".join(chunk), len(lines)
