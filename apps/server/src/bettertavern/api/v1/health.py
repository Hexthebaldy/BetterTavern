"""运维接口：/health 只看进程活着（顺带报版本）；/ready 在开始优雅退出时转为不就绪。"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from bettertavern import __version__
from bettertavern.api.deps import SettingsDep
from bettertavern.api.lifecycle import Shutdown

router = APIRouter(tags=["ops"])


@router.get("/health")
async def health(settings: SettingsDep) -> dict[str, str]:
    return {"status": "ok", "version": __version__, "build": settings.build_id}


@router.get("/ready")
async def ready(request: Request, response: Response) -> dict[str, str]:
    shutdown: Shutdown | None = getattr(request.app.state, "shutdown", None)
    if shutdown is not None and shutdown.triggered:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "shutting_down"}
    return {"status": "ready"}
