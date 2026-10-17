"""vis 的 HTTP 服务：/api/* 给网页数据，其他路径给构建好的网页（apps/vis/dist）。

所有接口只读。数据库连不上时，依赖数据库的部分返回 503，只看日志的部分照常工作。
故事文本只在 story_allowed（非生产环境）并且请求带 ?story=1 时返回。
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncEngine

from . import queries
from .issues import recent_problems, turn_issues
from .logstore import LogStore
from .timeline import build_timeline
from .views import filter_logs, log_metrics, requests, turns_by_request

_UUID = re.compile(r"^[0-9a-fA-F-]{36}$")
_ID_PREFIX = re.compile(r"^[0-9a-zA-Z._:-]{6,64}$")

_NO_WEB = """<!doctype html><meta charset="utf-8"><title>BetterTavern vis</title>
<body style="font-family:system-ui;padding:40px;line-height:1.7">
<h2>The web app hasn't been built yet</h2>
<p>The API is running (<a href="/api/meta">/api/meta</a>). To build the web app:</p>
<pre>cd apps/vis &amp;&amp; npm install &amp;&amp; npm run build</pre>
<p>Or, during development, run <code>npm run dev</code> and open the address it prints.</p>
</body>"""


def create_vis_app(
    *,
    store: LogStore,
    engine: AsyncEngine | None,
    web_dir: Path | None,
    story_allowed: bool,
    env: str,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(store.refresh, force=True)
        try:
            yield
        finally:
            if engine is not None:
                await engine.dispose()

    app = FastAPI(title="BetterTavern vis", lifespan=lifespan, docs_url=None, redoc_url=None)

    async def logs() -> list[Any]:
        await asyncio.to_thread(store.refresh)
        return store.entries()

    def db() -> AsyncEngine:
        if engine is None:
            raise HTTPException(503, "No database configured")
        return engine

    async def with_db(fn: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            async with db().connect() as conn:
                return await fn(conn, *args, **kwargs)
        except HTTPException:
            raise
        except Exception as exc:  # 数据库连不上：只影响需要数据库的部分
            raise HTTPException(503, f"Can't reach the database: {type(exc).__name__}") from exc

    def story_on(story: int) -> bool:
        return story_allowed and story == 1

    @app.get("/api/meta")
    async def meta() -> dict[str, Any]:
        await asyncio.to_thread(store.refresh)
        status = store.status()
        db_ok = False
        if engine is not None:
            try:
                async with engine.connect() as conn:
                    await conn.exec_driver_sql("SELECT 1")
                db_ok = True
            except Exception:
                db_ok = False
        return {
            "env": env,
            "story_allowed": story_allowed,
            "db": db_ok,
            "logs": {
                "directory": status.directory,
                "files": status.files,
                "entries": status.entries,
                "skipped_lines": status.skipped_lines,
                "oldest": status.oldest,
                "newest": status.newest,
                "cursor": status.cursor,
            },
            "now": time.time() * 1000,
        }

    @app.get("/api/overview")
    async def overview(hours: int = Query(24, ge=1, le=24 * 30)) -> dict[str, Any]:
        entries = await logs()
        since = time.time() * 1000 - hours * 3600 * 1000
        data: dict[str, Any] = {
            "hours": hours,
            "logs": log_metrics(entries, since=since),
            "problems": [g.to_json() for g in recent_problems(entries, since=since)[:30]],
        }
        try:
            data["db"] = await with_db(queries.overview, hours)
        except HTTPException as exc:
            data["db"] = None
            data["db_error"] = exc.detail
        return data

    @app.get("/api/playthroughs")
    async def playthroughs() -> dict[str, Any]:
        return {"playthroughs": await with_db(queries.list_playthroughs)}

    @app.get("/api/playthroughs/{playthrough_id}")
    async def playthrough(playthrough_id: str, story: int = 0) -> dict[str, Any]:
        if not _UUID.match(playthrough_id):
            raise HTTPException(404, "Story not found")
        detail = await with_db(queries.playthrough_detail, playthrough_id, story=story_on(story))
        if detail is None:
            raise HTTPException(404, "Story not found")
        entries = await logs()
        # 每个回合在日志里的重试、断线次数，回合列表上显示
        counts: dict[str, dict[str, int]] = {}
        wanted = {t["id"] for t in detail["turns"]}
        for e in entries:
            tid = e.get("turn_id")
            if tid not in wanted:
                continue
            c = counts.setdefault(tid, {"retries": 0, "sse_drops": 0, "warnings": 0})
            if e.event == "provider.retry":
                c["retries"] += 1
            elif e.event == "sse.close" and e.get("reason") == "client_gone":
                c["sse_drops"] += 1
            if e.level in ("warning", "error", "critical"):
                c["warnings"] += 1
        for turn in detail["turns"]:
            turn["log"] = counts.get(turn["id"], {"retries": 0, "sse_drops": 0, "warnings": 0})
        return detail

    @app.get("/api/turns/{turn_id}")
    async def turn(turn_id: str, story: int = 0) -> dict[str, Any]:
        if not _UUID.match(turn_id):
            raise HTTPException(404, "Turn not found")
        await asyncio.to_thread(store.refresh)
        entries = store.for_turn(turn_id)
        detail: dict[str, Any] | None
        db_error = None
        try:
            detail = await with_db(queries.turn_detail, turn_id, story=story_on(story))
        except HTTPException as exc:
            detail, db_error = None, exc.detail
        if detail is None and not entries:
            raise HTTPException(404, db_error or "Turn not found")
        turn_row = detail["turn"] if detail else None
        timeline = build_timeline(
            entries, running=bool(turn_row and turn_row["status"] == "generating")
        )
        issues = turn_issues(
            entries, timeline, turn=turn_row, runs=detail["runs"] if detail else []
        )
        return {
            "turn": turn_row,
            "runs": detail["runs"] if detail else [],
            "neighbours": detail["neighbours"] if detail else [],
            "timeline": timeline.to_json(),
            "issues": [i.to_json() for i in issues],
            "entries": [e.to_json() for e in entries],
            "db_error": db_error,
        }

    @app.get("/api/requests")
    async def request_list(
        kind: str = Query("all", pattern="^(all|failed|slow)$"),
        limit: int = Query(300, ge=1, le=2000),
    ) -> dict[str, Any]:
        entries = await logs()
        return {
            "requests": requests(
                entries, kind=kind, turns_of=turns_by_request(entries), limit=limit
            )
        }

    @app.get("/api/requests/{request_id}")
    async def request_detail(request_id: str) -> dict[str, Any]:
        await asyncio.to_thread(store.refresh)
        entries = store.lookup("request_id", request_id)
        if not entries:
            raise HTTPException(404, "No such request id in the logs")
        turn_ids: list[str] = []
        for e in entries:
            tid = e.get("turn_id")
            if isinstance(tid, str) and tid not in turn_ids:
                turn_ids.append(tid)
        access = next((e for e in reversed(entries) if e.event == "http.request"), None)
        return {
            "request_id": request_id,
            "request": access.to_json() if access else None,
            "turn_ids": turn_ids,
            "entries": [e.to_json() for e in entries],
        }

    @app.get("/api/logs")
    async def log_list(
        level: str = "debug",
        q: str = "",
        id: str = "",
        file: str = "",
        after: int = 0,
        limit: int = Query(500, ge=1, le=5000),
    ) -> dict[str, Any]:
        entries = await logs()
        found = filter_logs(
            entries, level=level, q=q, ident=id, file=file, after=after, limit=limit
        )
        return {
            "entries": [e.to_json() for e in found],
            "cursor": store.status().cursor,
            "files": sorted({e.source for e in entries}),
        }

    @app.get("/api/search")
    async def search(q: str) -> dict[str, Any]:
        value = q.strip()
        if not _ID_PREFIX.match(value):
            return {"results": []}
        await asyncio.to_thread(store.refresh)
        results: list[dict[str, Any]] = [
            {"kind": "request", "id": rid}
            for rid in store.request_ids(value.lower()) + store.request_ids(value)
        ]
        results = list({r["id"]: r for r in results}.values())
        if re.fullmatch(r"[0-9a-fA-F-]+", value):
            with contextlib.suppress(HTTPException):  # 数据库连不上就只查日志
                results += await with_db(queries.find_ids, value)
        return {"results": results[:30]}

    @app.exception_handler(HTTPException)
    async def http_error(_request: Any, exc: HTTPException) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    def static_file(path: str) -> Path | None:
        """网页的静态文件；不存在就给 index.html（前端路由），网页没构建返回 None"""
        if web_dir is None or not (web_dir / "index.html").is_file():
            return None
        candidate = (web_dir / path).resolve()
        if path and candidate.is_file() and web_dir.resolve() in candidate.parents:
            return candidate
        return web_dir / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def web(path: str) -> Any:
        if path.startswith("api/"):
            raise HTTPException(404, "No such endpoint")
        found = await asyncio.to_thread(static_file, path)
        return HTMLResponse(_NO_WEB) if found is None else FileResponse(found)

    return app
