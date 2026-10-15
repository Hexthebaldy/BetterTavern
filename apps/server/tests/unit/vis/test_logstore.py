"""读日志文件：增量读取、轮转、没写完的行、坏行、索引、按回合取记录。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from bettertavern.vis.logstore import LogStore


def line(event: str, second: float, **fields: Any) -> str:
    ts = f"2026-10-15T17:00:{second:06.3f}+08:00"
    return json.dumps({"timestamp": ts, "level": "info", "event": event, **fields}) + "\n"


def append(path: Path, text: str) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(text)


def store_for(tmp_path: Path) -> LogStore:
    return LogStore(tmp_path, min_interval_s=0)


def test_reads_new_lines_incrementally_and_keeps_half_written_lines(tmp_path: Path) -> None:
    log = tmp_path / "api.log"
    append(log, line("app.started", 1))
    store = store_for(tmp_path)
    assert store.refresh() == 1
    complete = line("http.request", 2, request_id="r1")
    append(log, complete[:20])  # 只写了半行
    assert store.refresh() == 0
    append(log, complete[20:])
    assert store.refresh() == 1
    assert [e.event for e in store.entries()] == ["app.started", "http.request"]
    assert [e.n for e in store.entries()] == [1, 2]


def test_follows_rotation_without_losing_or_repeating_lines(tmp_path: Path) -> None:
    log = tmp_path / "api.log"
    append(log, line("a", 1))
    store = store_for(tmp_path)
    store.refresh()
    append(log, line("b", 2))
    log.rename(tmp_path / "api.log.1")  # 轮转：旧文件改名，新文件从头写
    append(log, line("c", 3))
    store.refresh()
    assert [e.event for e in store.entries()] == ["a", "b", "c"]
    store.refresh()
    assert len(store.entries()) == 3


def test_rotated_files_from_before_start_are_read_oldest_first(tmp_path: Path) -> None:
    append(tmp_path / "api.log.2", line("first", 1))
    append(tmp_path / "api.log.1", line("second", 2))
    append(tmp_path / "api.log", line("third", 3))
    append(tmp_path / "worker.log", line("job.done", 2.5, job_id="7"))
    (tmp_path / "notes.txt").write_text("ignored")
    store = store_for(tmp_path)
    store.refresh()
    assert [e.event for e in store.entries()] == ["first", "second", "job.done", "third"]
    assert {e.source for e in store.entries()} == {"api", "worker"}


def test_bad_lines_are_counted_and_skipped(tmp_path: Path) -> None:
    append(tmp_path / "api.log", "not json\n[1,2]\n" + line("ok", 1))
    store = store_for(tmp_path)
    store.refresh()
    assert [e.event for e in store.entries()] == ["ok"]
    assert store.status().skipped_lines == 2


def test_turn_entries_include_the_requests_that_touched_the_turn(tmp_path: Path) -> None:
    append(
        tmp_path / "api.log",
        line(
            "http.request",
            1,
            request_id="submit-1",
            route="/v1/playthroughs/{playthrough_id}/turns",
        )
        + line("turn.submitted", 0.5, request_id="submit-1", turn_id="T")
        + line("turn.committed", 4, request_id="submit-1", turn_id="T")
        + line("http.request", 5, request_id="other")
        + line("sse.close", 6, request_id="sse-1", turn_id="T"),
    )
    store = store_for(tmp_path)
    store.refresh()
    events = [e.event for e in store.for_turn("T")]
    assert events == ["turn.submitted", "http.request", "turn.committed", "sse.close"]
    assert store.request_ids("sub") == ["submit-1"]


def test_oldest_entries_are_dropped_past_the_limit(tmp_path: Path) -> None:
    append(tmp_path / "api.log", "".join(line("e", i, request_id=f"r{i}") for i in range(20)))
    store = LogStore(tmp_path, max_entries=10, min_interval_s=0)
    store.refresh()
    assert len(store.entries()) == 9
    assert store.lookup("request_id", "r0") == []
    assert len(store.lookup("request_id", "r19")) == 1
