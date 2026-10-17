"""增量 SSE 解析：按字节喂入，按事件吐出。

处理 \\n、\\r\\n、\\r 三种行尾（包括 \\r\\n 被拆在两个 chunk 里）、多行 data、注释行和
开头的 BOM。单行超过上限（默认 1MB）就报错，防止上游无限输出一行把内存撑爆。
"""

from __future__ import annotations

from dataclasses import dataclass

_BOM = b"\xef\xbb\xbf"


@dataclass(frozen=True, slots=True)
class SseEvent:
    data: str
    event: str | None = None
    id: str | None = None
    retry: int | None = None


class SseLineTooLong(Exception):
    pass


class SseDecoder:
    def __init__(self, max_line_bytes: int = 1 << 20) -> None:
        self._max_line = max_line_bytes
        self._buf = bytearray()
        self._first_line = True
        self._data: list[str] = []
        self._event: str | None = None
        self._id: str | None = None
        self._retry: int | None = None
        self.last_event_id: str | None = None
        self.comments = 0

    def feed(self, chunk: bytes) -> list[SseEvent]:
        self._buf += chunk
        events: list[SseEvent] = []
        buf = self._buf
        pos = 0
        size = len(buf)
        while pos < size:
            nl = buf.find(b"\n", pos)
            cr = buf.find(b"\r", pos)
            if nl == -1 and cr == -1:
                break
            if cr != -1 and (nl == -1 or cr < nl):
                if cr == size - 1:
                    break  # 看不到下一个字节，无法判断是不是 \r\n，等下一个 chunk
                line = bytes(buf[pos:cr])
                pos = cr + 2 if buf[cr + 1] == 0x0A else cr + 1
            else:
                line = bytes(buf[pos:nl])
                pos = nl + 1
            event = self._process_line(line)
            if event is not None:
                events.append(event)
        del buf[:pos]
        if len(buf) > self._max_line:
            raise SseLineTooLong(f"SSE line exceeds {self._max_line} bytes")
        return events

    def flush(self) -> list[SseEvent]:
        """流结束时调用：处理没有行尾的最后一行，并派发未以空行结束的事件。"""
        events: list[SseEvent] = []
        if self._buf:
            line = bytes(self._buf).rstrip(b"\r")
            self._buf.clear()
            event = self._process_line(line)
            if event is not None:
                events.append(event)
        event = self._dispatch()
        if event is not None:
            events.append(event)
        return events

    def _process_line(self, line: bytes) -> SseEvent | None:
        if self._first_line:
            self._first_line = False
            if line.startswith(_BOM):
                line = line[len(_BOM) :]
        if not line:
            return self._dispatch()
        text = line.decode("utf-8", errors="replace")
        if text.startswith(":"):
            self.comments += 1
            return None
        field, sep, value = text.partition(":")
        if sep and value.startswith(" "):
            value = value[1:]
        if field == "data":
            self._data.append(value)
        elif field == "event":
            self._event = value
        elif field == "id":
            if "\0" not in value:
                self._id = value
                self.last_event_id = value
        elif field == "retry" and value.isdigit():
            self._retry = int(value)
        return None

    def _dispatch(self) -> SseEvent | None:
        if not self._data:
            self._event = None
            self._id = None
            self._retry = None
            return None
        event = SseEvent(
            data="\n".join(self._data), event=self._event, id=self._id, retry=self._retry
        )
        self._data = []
        self._event = None
        self._id = None
        self._retry = None
        return event
