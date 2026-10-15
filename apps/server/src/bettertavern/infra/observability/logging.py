"""日志配置：本项目的 structlog 日志，以及 uvicorn、asyncpg 等第三方库的标准库 logging，
走同一条处理链。

每条日志依次经过：
1. 合并上下文：请求单号、用户代号、故事编号、回合编号等，在请求或任务开始时绑定一次，
   之后打的每一条都自动带上；
2. 加上级别、来源模块、本地时间（带时区）、进程（api / worker）；
3. 把异常格式化成文字；
4. 脱敏（redact.py）；
5. 输出：终端里开发时是带颜色的单行，生产环境或不是终端时是 JSON；另外可以按进程写一份 JSON 到文件
   （开发时默认写，在 data_dir/logs/api.log、worker.log，每个文件 10 MB 轮转、保留 5 份），
   vis 读的就是它。

写日志的写法：

    log = structlog.get_logger(__name__)
    log.info("turn.committed", seq=3, duration_ms=812)

事件名用固定的英文点分名字，具体数值放字段里，不把变量拼进事件名。
一个步骤结束时记的事件带上 duration_ms，
vis 用它把步骤画成时间条。
"""

from __future__ import annotations

import logging
import logging.handlers
import sys
from datetime import datetime
from pathlib import Path
from typing import Literal

import structlog
from structlog.types import EventDict, Processor

from .redact import Redactor

LogFormat = Literal["auto", "console", "json"]

FILE_MAX_BYTES = 10 * 1024 * 1024
FILE_BACKUPS = 5

# 第三方库里太啰嗦的，只留警告以上
_QUIET = ("httpx", "httpcore", "asyncio", "sqlalchemy", "watchfiles", "multipart", "hpack")


def log_dir(data_dir: Path) -> Path:
    return data_dir / "logs"


def log_file_path(data_dir: Path, process: str) -> Path:
    return log_dir(data_dir) / f"{process}.log"


def _local_timestamp(logger: object, method: str, event_dict: EventDict) -> EventDict:
    # 本地时间带时区偏移：终端里直接对得上手表，JSON 里也没有歧义
    event_dict["timestamp"] = datetime.now().astimezone().isoformat(timespec="milliseconds")
    return event_dict


def _add_process(process: str) -> Processor:
    def add(logger: object, method: str, event_dict: EventDict) -> EventDict:
        event_dict.setdefault("process", process)
        return event_dict

    return add


def configure_logging(
    *,
    level: str = "INFO",
    process: str = "api",
    fmt: LogFormat = "auto",
    file: Path | None = None,
    keep_story: bool = False,
    cache: bool = True,
) -> None:
    """配置一次，之后整个进程的日志都按这里来。重复调用会替换掉之前的配置"""
    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        _local_timestamp,
        _add_process(process),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        Redactor(keep_story=keep_story),
    ]
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=cache,
    )

    use_json = fmt == "json" or (fmt == "auto" and not sys.stderr.isatty())
    console_renderer: Processor = (
        structlog.processors.JSONRenderer(ensure_ascii=False)
        if use_json
        else structlog.dev.ConsoleRenderer(
            colors=True, exception_formatter=structlog.dev.plain_traceback
        )
    )
    handlers: list[logging.Handler] = [
        _handler(logging.StreamHandler(sys.stderr), shared, console_renderer)
    ]
    if file is not None:
        file.parent.mkdir(parents=True, exist_ok=True)
        rotating = logging.handlers.RotatingFileHandler(
            file, maxBytes=FILE_MAX_BYTES, backupCount=FILE_BACKUPS, encoding="utf-8"
        )
        handlers.append(
            _handler(rotating, shared, structlog.processors.JSONRenderer(ensure_ascii=False))
        )

    root = logging.getLogger()
    for old in list(root.handlers):
        root.removeHandler(old)
        old.close()
    for handler in handlers:
        root.addHandler(handler)
    root.setLevel(level.upper())
    for name in _QUIET:
        logging.getLogger(name).setLevel(logging.WARNING)
    # 访问日志由 api 的中间件记（http.request），不用 uvicorn 自带的
    logging.getLogger("uvicorn.access").disabled = True
    # uvicorn 自己的日志交给根日志器统一输出
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True


def _handler(
    handler: logging.Handler, shared: list[Processor], renderer: Processor
) -> logging.Handler:
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared,
            processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, renderer],
        )
    )
    return handler
