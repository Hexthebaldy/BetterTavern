"""按配置初始化日志：api、worker、vis 三个进程启动时各调一次。"""

from __future__ import annotations

from bettertavern.infra.observability.logging import configure_logging, log_file_path
from bettertavern.settings import Settings


def setup_logging(settings: Settings, process: str, *, to_file: bool = True) -> None:
    """to_file=False 用于只需要终端输出的场合（例如开发时自动重启的那个监视进程）"""
    file = (
        log_file_path(settings.data_dir, process) if to_file and settings.log_file_enabled else None
    )
    configure_logging(
        level=settings.log_level,
        process=process,
        fmt=settings.log_format,
        file=file,
        keep_story=settings.log_story_text and not settings.is_prod,
    )
