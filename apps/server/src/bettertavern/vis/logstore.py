"""读日志文件：data_dir/logs 下每个进程一个 JSON 日志（api.log、worker.log），
加上轮转出来的 .1 到 .5。

- 增量读取：按文件的 inode 记住读到哪里，之后只读新增的部分；轮转时旧文件被改名成 .1，inode 不变，
  所以剩下没读的照样接着读，新的 api.log 从头读。最后一行没写完（没有换行）就留到下次。
- 每条记录解析成 Entry：n 是读入的顺序号（只增不减，网页拿它做“从这里往后”的游标），
  t 是时间（毫秒）。
- 按请求单号、回合编号、故事编号、任务编号建索引；超过上限时丢掉最早的记录并重建索引。
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

_ROTATED = re.compile(r"^(?P<base>[\w.-]+\.log)(?:\.(?P<n>\d+))?$")
LEVEL_RANK = {"debug": 0, "info": 1, "warning": 2, "error": 3, "critical": 4}
INDEX_KEYS = ("request_id", "turn_id", "playthrough_id", "job_id")


@dataclass(slots=True)
class Entry:
    n: int
    t: float
    source: str
    data: dict[str, Any]
    line: str

    @property
    def event(self) -> str:
        return str(self.data.get("event", ""))

    @property
    def level(self) -> str:
        return str(self.data.get("level", "info"))

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def to_json(self) -> dict[str, Any]:
        # 日志文件名放在 file 里：记录自己的字段里也可能有 source（例如行动来源），不能覆盖
        return {**self.data, "n": self.n, "t": self.t, "file": self.source}


def parse_time(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value).timestamp() * 1000
    except ValueError:
        return None


@dataclass
class _FileState:
    offset: int = 0
    pending: bytes = b""


@dataclass
class StoreStatus:
    directory: str
    files: list[dict[str, Any]] = field(default_factory=list)
    entries: int = 0
    skipped_lines: int = 0
    oldest: float | None = None
    newest: float | None = None
    cursor: int = 0


class LogStore:
    def __init__(
        self,
        directory: Path,
        *,
        max_entries: int = 200_000,
        min_interval_s: float = 0.5,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.directory = directory
        self.max_entries = max_entries
        self._min_interval = min_interval_s
        self._clock = clock
        self._last_refresh = float("-inf")
        self._lock = threading.Lock()
        self._files: dict[tuple[int, int], _FileState] = {}
        self._entries: list[Entry] = []
        self._sorted = True
        self._index: dict[str, dict[str, list[Entry]]] = {k: defaultdict(list) for k in INDEX_KEYS}
        self._next_n = 1
        self._skipped = 0

    # ---- 读取 ---------------------------------------------------------------------------
    def refresh(self, *, force: bool = False) -> int:
        """读新增的记录，返回读到几条。离上次读不到 min_interval_s 秒就跳过（除非 force）"""
        with self._lock:
            now = self._clock()
            if not force and now - self._last_refresh < self._min_interval:
                return 0
            self._last_refresh = now
            added = 0
            for path in self._ordered_files():
                added += self._read_file(path)
            if len(self._entries) > self.max_entries:
                self._trim()
            return added

    def _ordered_files(self) -> list[Path]:
        """每个进程的文件按时间顺序：.5 … .1，最后是正在写的那个"""
        if not self.directory.is_dir():
            return []
        groups: dict[str, list[tuple[int, Path]]] = defaultdict(list)
        for path in self.directory.iterdir():
            match = _ROTATED.match(path.name)
            if match is None or not path.is_file():
                continue
            number = int(match.group("n")) if match.group("n") else 0
            groups[match.group("base")].append((number, path))
        ordered: list[Path] = []
        for base in sorted(groups):
            ordered += [p for _, p in sorted(groups[base], key=lambda item: -item[0])]
        return ordered

    def _read_file(self, path: Path) -> int:
        try:
            stat = path.stat()
        except OSError:
            return 0
        key = (stat.st_dev, stat.st_ino)
        state = self._files.setdefault(key, _FileState())
        if stat.st_size < state.offset:  # 被截断或重写了
            state.offset, state.pending = 0, b""
        if stat.st_size == state.offset:
            return 0
        try:
            with path.open("rb") as handle:
                handle.seek(state.offset)
                chunk = handle.read(stat.st_size - state.offset)
        except OSError:
            return 0
        state.offset += len(chunk)
        data = state.pending + chunk
        complete, newline, rest = data.rpartition(b"\n")
        state.pending = rest
        if not newline:
            return 0
        match = _ROTATED.match(path.name)
        source = match.group("base").removesuffix(".log") if match else path.name
        return self._ingest(complete.decode("utf-8", errors="replace").split("\n"), source)

    def _ingest(self, lines: Iterable[str], source: str) -> int:
        added = 0
        last_t = self._entries[-1].t if self._entries else 0.0
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                self._skipped += 1
                continue
            if not isinstance(data, dict):
                self._skipped += 1
                continue
            t = parse_time(data.get("timestamp"))
            if t is None:
                t = last_t
            last_t = t
            entry = Entry(n=self._next_n, t=t, source=source, data=data, line=line)
            self._next_n += 1
            if self._entries and t < self._entries[-1].t:
                self._sorted = False
            self._entries.append(entry)
            self._add_to_index(entry)
            added += 1
        return added

    def _add_to_index(self, entry: Entry) -> None:
        for key in INDEX_KEYS:
            value = entry.data.get(key)
            if isinstance(value, str) and value:
                self._index[key][value].append(entry)

    def _trim(self) -> None:
        self._ensure_sorted()
        drop = len(self._entries) - int(self.max_entries * 0.9)
        self._entries = self._entries[drop:]
        self._index = {k: defaultdict(list) for k in INDEX_KEYS}
        for entry in self._entries:
            self._add_to_index(entry)

    def _ensure_sorted(self) -> None:
        if not self._sorted:
            self._entries.sort(key=lambda e: (e.t, e.n))
            self._sorted = True

    # ---- 查询 ---------------------------------------------------------------------------
    def entries(self) -> list[Entry]:
        """全部记录，按时间排好"""
        with self._lock:
            self._ensure_sorted()
            return list(self._entries)

    def lookup(self, key: str, value: str) -> list[Entry]:
        with self._lock:
            return sorted(self._index[key].get(value, ()), key=lambda e: (e.t, e.n))

    def request_ids(self, prefix: str, limit: int = 20) -> list[str]:
        with self._lock:
            found = [rid for rid in self._index["request_id"] if rid.startswith(prefix)]
        return sorted(found)[:limit]

    def for_turn(self, turn_id: str) -> list[Entry]:
        """一个回合的全部记录：带这个回合编号的，加上它们所属请求的其他记录（比如提交请求的访问日志）"""
        own = self.lookup("turn_id", turn_id)
        request_ids = {e.get("request_id") for e in own if isinstance(e.get("request_id"), str)}
        seen = {e.n for e in own}
        merged = list(own)
        for rid in request_ids:
            for entry in self.lookup("request_id", rid):
                # 同一个请求里如果又绑了别的回合（不会发生，防御一下），不混进来
                other = entry.get("turn_id")
                if entry.n not in seen and (other is None or other == turn_id):
                    seen.add(entry.n)
                    merged.append(entry)
        return sorted(merged, key=lambda e: (e.t, e.n))

    def status(self) -> StoreStatus:
        with self._lock:
            self._ensure_sorted()
            files = []
            for path in self._ordered_files():
                try:
                    stat = path.stat()
                except OSError:
                    continue
                files.append(
                    {"name": path.name, "bytes": stat.st_size, "modified": stat.st_mtime * 1000}
                )
            return StoreStatus(
                directory=str(self.directory.resolve()),
                files=files,
                entries=len(self._entries),
                skipped_lines=self._skipped,
                oldest=self._entries[0].t if self._entries else None,
                newest=self._entries[-1].t if self._entries else None,
                cursor=self._next_n - 1,
            )


def level_at_least(entry: Entry, minimum: str) -> bool:
    return LEVEL_RANK.get(entry.level, 1) >= LEVEL_RANK.get(minimum, 0)
