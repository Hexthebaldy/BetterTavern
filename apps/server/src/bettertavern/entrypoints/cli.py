"""命令行入口：bettertavern serve / worker / migrate。"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[3]


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    from bettertavern.settings import Settings

    settings = Settings()
    host = args.host or settings.host
    port = args.port or settings.port
    if args.reload:
        # 开发时自动重启：uvicorn 需要导入路径，不做优雅退出
        uvicorn.run(
            "bettertavern.entrypoints.api:create_app",
            factory=True,
            host=host,
            port=port,
            reload=True,
            log_level=settings.log_level.lower(),
        )
        return

    from bettertavern.api.lifecycle import Shutdown
    from bettertavern.entrypoints.api import create_app
    from bettertavern.entrypoints.server import GracefulServer

    shutdown = Shutdown()
    config = uvicorn.Config(
        create_app(settings, shutdown=shutdown),
        host=host,
        port=port,
        log_level=settings.log_level.lower(),
        timeout_graceful_shutdown=int(settings.shutdown_grace_s),
    )
    GracefulServer(config, shutdown).run()


def _worker(args: argparse.Namespace) -> None:
    from bettertavern.entrypoints.worker import run_worker
    from bettertavern.settings import Settings

    settings = Settings()
    _configure_logging(settings.log_level)
    asyncio.run(run_worker(settings))


def _migrate(args: argparse.Namespace) -> None:
    from alembic.config import main as alembic_main

    config = os.environ.get("ALEMBIC_CONFIG", str(SERVER_ROOT / "alembic.ini"))
    alembic_main(argv=["-c", config, "upgrade", args.revision])


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="bettertavern", description="BetterTavern 服务端")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="启动 api 进程")
    serve.add_argument("--host")
    serve.add_argument("--port", type=int)
    serve.add_argument("--reload", action="store_true", help="开发时代码改动自动重启")
    serve.set_defaults(func=_serve)

    worker = sub.add_parser("worker", help="启动 worker 进程")
    worker.set_defaults(func=_worker)

    migrate = sub.add_parser("migrate", help="执行数据库迁移")
    migrate.add_argument("revision", nargs="?", default="head")
    migrate.set_defaults(func=_migrate)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main(sys.argv[1:])
