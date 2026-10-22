"""边收边读工具参数里的一个字符串值（给工作台的 field_delta 用，docs/workbench.md 第 3.8 节）。

模型调“写字段”工具时，参数（JSON）是一点一点流过来的。我们只关心其中一个键（比如 text）的字符串值：
每收到一段就调 feed()，返回这次新解出来的那部分文字（转义已经还原）；
键还没出现或者值已经结束时返回空串。
只处理顶层对象里的这个键；嵌套在别的对象、数组里的同名键不算。整个参数收完以后仍然以完整解析为准。
"""

from __future__ import annotations

_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


class PartialStringField:
    def __init__(self, key: str) -> None:
        self._key = key
        self._buf = ""
        self._pos = 0  # 扫到哪了
        self._depth = 0  # 括号深度（对象和数组）
        self._in_string = False
        self._string_start = 0
        self._last_key: str | None = None  # 顶层最近读到的键
        self._expect_key = True  # 顶层下一个字符串是键还是值
        self._capturing = False
        self._done = False
        self._pending_escape = ""  # 还没收全的转义（例如 \u4e 只到一半）

    @property
    def done(self) -> bool:
        return self._done

    def feed(self, chunk: str) -> str:
        if self._done:
            return ""
        self._buf += chunk
        out: list[str] = []
        while self._pos < len(self._buf):
            ch = self._buf[self._pos]
            if self._capturing:
                if self._pending_escape or ch == "\\":
                    text = self._pending_escape + self._buf[self._pos :]
                    decoded, used, complete = _escape(text)
                    if not complete:
                        self._pending_escape = text
                        self._pos = len(self._buf)
                        break
                    out.append(decoded)
                    self._pos += used - len(self._pending_escape)
                    self._pending_escape = ""
                    continue
                if ch == '"':
                    self._capturing = False
                    self._done = True
                    self._pos += 1
                    break
                out.append(ch)
                self._pos += 1
                continue
            if self._in_string:
                if ch == "\\":
                    if self._pos + 1 >= len(self._buf):
                        break  # 等下一段
                    self._pos += 2
                    continue
                if ch == '"':
                    self._in_string = False
                    if self._depth == 1 and self._expect_key:
                        self._last_key = self._buf[self._string_start : self._pos]
                    elif self._depth == 1:
                        self._expect_key = True
                self._pos += 1
                continue
            if ch == '"':
                if self._depth == 1 and not self._expect_key and self._last_key == self._key:
                    self._capturing = True
                    self._pos += 1
                    continue
                self._in_string = True
                self._string_start = self._pos + 1
            elif ch in "{[":
                self._depth += 1
            elif ch in "}]":
                self._depth -= 1
                if self._depth == 1:
                    self._expect_key = True
            elif ch == ":" and self._depth == 1:
                self._expect_key = False
            elif ch == "," and self._depth == 1:
                self._expect_key = True
            self._pos += 1
        return "".join(out)


def _escape(text: str) -> tuple[str, int, bool]:
    """text 以反斜杠开头：返回 (还原的字符, 用掉的长度, 是否完整)。"""
    if len(text) < 2:
        return "", 0, False
    kind = text[1]
    if kind != "u":
        return _ESCAPES.get(kind, kind), 2, True
    if len(text) < 6:
        return "", 0, False
    code = int(text[2:6], 16) if _is_hex(text[2:6]) else 0xFFFD
    if 0xD800 <= code < 0xDC00:  # 代理对的前半个，要等后半个
        if len(text) < 12:
            return "", 0, False
        if text[6:8] == "\\u" and _is_hex(text[8:12]):
            low = int(text[8:12], 16)
            if 0xDC00 <= low < 0xE000:
                return chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)), 12, True
        return "�", 6, True
    return chr(code), 6, True


def _is_hex(text: str) -> bool:
    return len(text) == 4 and all(c in "0123456789abcdefABCDEF" for c in text)
