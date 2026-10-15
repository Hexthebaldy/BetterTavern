"""命令行入口：bettertavern serve / worker / migrate / keygen。"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[3]


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    from bettertavern.entrypoints.logging_setup import setup_logging
    from bettertavern.settings import Settings

    settings = Settings()
    host = args.host or settings.host
    port = args.port or settings.port
    # 日志全部由我们自己配（log_config=None），访问日志由 api 的中间件记（access_log=False）
    if args.reload:
        # 开发时自动重启：uvicorn 需要导入路径，不做优雅退出。
        # 这个进程只负责监视文件，日志只打到终端；重启出来的进程在 create_dev_app 里配日志并写文件
        setup_logging(settings, "api", to_file=False)
        uvicorn.run(
            "bettertavern.entrypoints.api:create_dev_app",
            factory=True,
            host=host,
            port=port,
            reload=True,
            log_level=settings.log_level.lower(),
            log_config=None,
            access_log=False,
        )
        return

    setup_logging(settings, "api")

    from bettertavern.api.lifecycle import Shutdown
    from bettertavern.entrypoints.api import create_app
    from bettertavern.entrypoints.server import GracefulServer

    shutdown = Shutdown()
    config = uvicorn.Config(
        create_app(settings, shutdown=shutdown),
        host=host,
        port=port,
        log_level=settings.log_level.lower(),
        log_config=None,
        access_log=False,
        timeout_graceful_shutdown=int(settings.shutdown_grace_s),
    )
    GracefulServer(config, shutdown).run()


def _worker(args: argparse.Namespace) -> None:
    from bettertavern.entrypoints.logging_setup import setup_logging
    from bettertavern.entrypoints.worker import run_worker
    from bettertavern.settings import Settings

    settings = Settings()
    setup_logging(settings, "worker")
    asyncio.run(run_worker(settings))


def _vis(args: argparse.Namespace) -> None:
    import uvicorn

    from bettertavern.entrypoints.logging_setup import setup_logging
    from bettertavern.infra.db.engine import create_engine
    from bettertavern.infra.observability.logging import log_dir
    from bettertavern.settings import Settings
    from bettertavern.vis.app import create_vis_app
    from bettertavern.vis.logstore import LogStore

    settings = Settings()
    # vis 自己的日志只打到终端，不写进它要读的日志目录
    setup_logging(settings, "vis", to_file=False)
    directory = Path(args.log_dir) if args.log_dir else log_dir(settings.data_dir)
    web_dir = Path(args.web_dir) if args.web_dir else SERVER_ROOT.parent / "vis" / "dist"
    app = create_vis_app(
        store=LogStore(directory),
        engine=None if args.no_db else create_engine(settings.database_url, pool_size=2),
        web_dir=web_dir,
        story_allowed=not settings.is_prod,
        env=settings.env,
    )
    print(f"vis：http://{args.host}:{args.port}  日志目录 {directory.resolve()}")
    uvicorn.run(app, host=args.host, port=args.port, log_config=None, access_log=False)


def _migrate(args: argparse.Namespace) -> None:
    from alembic.config import main as alembic_main

    config = os.environ.get("ALEMBIC_CONFIG", str(SERVER_ROOT / "alembic.ini"))
    alembic_main(argv=["-c", config, "upgrade", args.revision])


def _keygen(args: argparse.Namespace) -> None:
    from bettertavern.infra.crypto.keyring import new_auth_secret, new_master_key_entry

    print("# 把下面两行加到 .env（或部署环境的密钥管理）里；主密钥丢了，已保存的模型密钥就解不开了")
    print(f"MASTER_KEYS={new_master_key_entry(args.kid)}")
    print(f"AUTH_SECRET={new_auth_secret()}")


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

    vis = sub.add_parser("vis", help="启动本机的可观测性查看器（网页）")
    # 只监听本机：vis 能看到所有用户的回合，不要对外开放
    vis.add_argument("--host", default="127.0.0.1")
    vis.add_argument("--port", type=int, default=8100)
    vis.add_argument("--log-dir", help="日志目录，默认 data_dir/logs")
    vis.add_argument("--web-dir", help="构建好的网页目录，默认 apps/vis/dist")
    vis.add_argument("--no-db", action="store_true", help="不连数据库，只看日志")
    vis.set_defaults(func=_vis)

    migrate = sub.add_parser("migrate", help="执行数据库迁移")
    migrate.add_argument("revision", nargs="?", default="head")
    migrate.set_defaults(func=_migrate)

    keygen = sub.add_parser("keygen", help="生成主密钥与令牌签名密钥")
    keygen.add_argument("--kid", help="主密钥编号，默认随机生成")
    keygen.set_defaults(func=_keygen)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main(sys.argv[1:])
