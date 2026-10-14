"""M0 的 SSE 探针：在服务端模拟一次长时间的流式生成，验证 RN 真机上的 SSE。

验收标准（docs/client.md）：iOS 与 Android 真机、Wi-Fi 与蜂窝网络，各跑一次 3 分钟以上的长流；
中文无乱码；中途断网再恢复后用 Last-Event-ID 续传，拼出的文本与最终叙述一致；
服务端发出到屏幕上出现的延迟 p95 小于 300 毫秒。

探针和真实回合用同一套机制：生成方往事件缓冲里发布，订阅方从任意位置续读。
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import secrets
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from bettertavern.runtime.events.buffer import EventBufferRegistry, EventStream

# 文本里刻意放了多字节字符：常用汉字、全角标点、emoji（含变体选择符）和扩展区汉字（4 字节）
_LINES = (
    "雨夜的酒馆里，木门吱呀一声被推开，潮湿的风卷着灯影晃了晃。",
    "掌柜擦着杯子，头也不抬：“𠮷野家的人又来了，你最好别多事。”🌧️",
    "我在角落坐下，听见炉火噼啪作响，墙上的旧地图缺了一角 🗺️。",
    "窗外传来马蹄声，由远及近，又在门口戛然而止——有人在等。",
)


def probe_text(total_chars: int) -> str:
    """生成至少 total_chars 个字符的确定性文本（按段编号，方便肉眼核对缺字）。"""
    parts: list[str] = []
    size = 0
    index = 0
    while size < total_chars:
        line = f"第{index + 1}段：{_LINES[index % len(_LINES)]}\n"
        parts.append(line)
        size += len(line)
        index += 1
    return "".join(parts)


class ProbeConfigError(ValueError):
    pass


# 单条探针的总字数上限。默认配置（180 秒 × 20 次/秒 × 8 字）约 2.9 万字，
# 上限留足余量，但不让一个请求吃掉大量内存
MAX_TOTAL_CHARS = 200_000


@dataclass(frozen=True, slots=True)
class ProbeConfig:
    duration_s: float = 180.0
    events_per_second: float = 20.0
    chars_per_event: int = 8

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any] | None) -> ProbeConfig:
        data = data or {}
        unknown = set(data) - {"duration_s", "events_per_second", "chars_per_event"}
        if unknown:
            raise ProbeConfigError(f"未知字段：{sorted(unknown)}")
        defaults = cls()
        try:
            config = cls(
                duration_s=float(data.get("duration_s", defaults.duration_s)),
                events_per_second=float(data.get("events_per_second", defaults.events_per_second)),
                chars_per_event=int(data.get("chars_per_event", defaults.chars_per_event)),
            )
        except (TypeError, ValueError) as exc:
            raise ProbeConfigError(str(exc)) from exc
        if not 1 <= config.duration_s <= 1800:
            raise ProbeConfigError("duration_s 取值 1 到 1800")
        if not 0.5 <= config.events_per_second <= 200:
            raise ProbeConfigError("events_per_second 取值 0.5 到 200")
        if not 1 <= config.chars_per_event <= 200:
            raise ProbeConfigError("chars_per_event 取值 1 到 200")
        if config.total_chars > MAX_TOTAL_CHARS:
            raise ProbeConfigError(
                f"总字数 {config.total_chars} 超过上限 {MAX_TOTAL_CHARS}，请缩短时长或降低速率"
            )
        return config

    @property
    def total_chars(self) -> int:
        return max(int(self.duration_s * self.events_per_second * self.chars_per_event), 1)


@dataclass
class ProbeRecord:
    stream_id: str
    config: ProbeConfig
    text: str
    sha256: str
    status: Literal["running", "completed", "failed"] = "running"
    sent_chars: int = 0
    events: int = 0
    finished_at: float | None = None  # time.monotonic()

    def to_json(self, *, include_text: bool) -> dict[str, Any]:
        body: dict[str, Any] = {
            "stream_id": self.stream_id,
            "status": self.status,
            "chars_total": len(self.text),
            "chars_sent": self.sent_chars,
            "events": self.events,
            "sha256": self.sha256,
        }
        if include_text:
            body["text"] = self.text
        return body


def now_ms() -> int:
    return int(time.time() * 1000)


class ProbeService:
    def __init__(
        self,
        buffers: EventBufferRegistry,
        *,
        clock_ms: Callable[[], int] = now_ms,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        max_running: int = 20,
        max_records: int = 100,
        retention: float = 3600.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._buffers = buffers
        self._clock_ms = clock_ms
        self._sleep = sleep
        self._max_running = max_running
        self._max_records = max_records
        self._retention = retention
        self._clock = clock
        self._records: dict[str, ProbeRecord] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def _evict(self) -> None:
        """清掉结束超过保留期的记录；记录太多时先清最早结束的。"""
        now = self._clock()
        finished = sorted(
            (r for r in self._records.values() if r.finished_at is not None),
            key=lambda r: r.finished_at or 0.0,
        )
        for record in finished:
            expired = now - (record.finished_at or now) > self._retention
            if expired or len(self._records) > self._max_records:
                del self._records[record.stream_id]

    async def start(self, config: ProbeConfig) -> ProbeRecord:
        self._evict()
        if len(self._tasks) >= self._max_running:
            raise ProbeConfigError(f"同时运行的探针不能超过 {self._max_running} 个")
        stream_id = "probe_" + secrets.token_hex(8)
        text = probe_text(config.total_chars)
        record = ProbeRecord(
            stream_id=stream_id,
            config=config,
            text=text,
            sha256=hashlib.sha256(text.encode()).hexdigest(),
        )
        stream = self._buffers.create(stream_id, max_events=len(text) + 16)
        self._records[stream_id] = record
        task = asyncio.create_task(self._produce(record, stream), name=f"probe-{stream_id}")
        self._tasks[stream_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(stream_id, None))
        return record

    def record(self, stream_id: str) -> ProbeRecord | None:
        return self._records.get(stream_id)

    def stream(self, stream_id: str) -> EventStream | None:
        # 事件缓冲与真实回合共用一个注册表：只交出探针自己建的流，
        # 否则不需要登录的探针接口就能按回合 id 读到别人的故事
        if not stream_id.startswith("probe_") or stream_id not in self._records:
            return None
        return self._buffers.get(stream_id)

    async def aclose(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _produce(self, record: ProbeRecord, stream: EventStream) -> None:
        config = record.config
        loop = asyncio.get_running_loop()
        try:
            await stream.publish(
                "turn.created",
                {"stream_id": record.stream_id, "chars": len(record.text), "seq": 0},
            )
            interval = 1.0 / config.events_per_second
            started = loop.time()
            position = 0
            while position < len(record.text):
                piece = record.text[position : position + config.chars_per_event]
                position += len(piece)
                record.events += 1
                await stream.publish(
                    "narrative.delta",
                    {"text": piece, "sent_at": self._clock_ms(), "n": record.events},
                )
                record.sent_chars = position
                delay = started + record.events * interval - loop.time()
                if delay > 0:
                    await self._sleep(delay)
            await stream.publish("narrative.done", {"chars": len(record.text)})
            record.status = "completed"
            await stream.publish(
                "turn.completed",
                {"chars": len(record.text), "sha256": record.sha256, "events": record.events},
            )
        except asyncio.CancelledError:
            record.status = "failed"
            with contextlib.suppress(Exception):
                await stream.publish(
                    "turn.failed", {"code": "SHUTTING_DOWN", "retryable": True, "partial": True}
                )
            raise
        finally:
            record.finished_at = self._clock()
            await stream.close()
