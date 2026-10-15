"""日志配置：项目日志和第三方库日志都按同一格式写进文件，带上绑定的编号，并且经过脱敏。"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
import structlog

from bettertavern.infra.observability.logging import configure_logging


@pytest.fixture
def log_file(tmp_path: Path) -> Iterator[Path]:
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    file = tmp_path / "logs" / "api.log"
    configure_logging(level="INFO", process="api", fmt="json", file=file, cache=False)
    try:
        yield file
    finally:
        for handler in list(root.handlers):
            root.removeHandler(handler)
            handler.close()
        for handler in saved[0]:
            root.addHandler(handler)
        root.setLevel(saved[1])
        structlog.contextvars.clear_contextvars()
        structlog.reset_defaults()


def read(file: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in file.read_text(encoding="utf-8").splitlines()]


def test_project_and_library_logs_share_one_format(log_file: Path) -> None:
    structlog.contextvars.bind_contextvars(request_id="req-12345678", turn_id="t1")
    structlog.get_logger("bettertavern.test").info(
        "turn.committed", seq=3, narrative="不该出现的故事"
    )
    logging.getLogger("some.library").warning("Authorization: Bearer abcdefghijklmnop failed")

    entries = read(log_file)
    assert [e["event"] for e in entries][-2:] == [
        "turn.committed",
        "Authorization: Bearer [REDACTED] failed",
    ]
    ours, theirs = entries[-2], entries[-1]
    assert ours["request_id"] == "req-12345678" and ours["turn_id"] == "t1"
    assert ours["level"] == "info" and ours["process"] == "api" and ours["seq"] == 3
    assert "narrative" not in ours
    assert theirs["level"] == "warning" and theirs["logger"] == "some.library"
    assert theirs["request_id"] == "req-12345678"
    assert str(ours["timestamp"])[10] == "T"


def test_exceptions_are_written_as_scrubbed_text(log_file: Path) -> None:
    try:
        raise ValueError("token=hf_secretsecret123 rejected")
    except ValueError:
        structlog.get_logger("bettertavern.test").exception("turn.crashed")
    entry = read(log_file)[-1]
    assert entry["event"] == "turn.crashed" and entry["level"] == "error"
    assert "ValueError" in str(entry["exception"])
    assert "hf_secretsecret123" not in str(entry["exception"])


def test_debug_is_dropped_below_the_configured_level(log_file: Path) -> None:
    log = structlog.get_logger("bettertavern.test")
    log.debug("events.swept", removed=1)
    log.info("app.started")
    assert [e["event"] for e in read(log_file)] == ["app.started"]
