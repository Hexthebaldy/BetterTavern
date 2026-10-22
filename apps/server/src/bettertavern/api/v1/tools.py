"""外部服务：搜索、读网页、文生图的配置（Key 加密存），以及“测试”。"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from bettertavern.api.deps import ServicesDep, UserId
from bettertavern.api.schemas.tools import (
    ToolProviderOut,
    ToolRouteIn,
    ToolRouteOut,
    ToolRoutePatchIn,
)
from bettertavern.services.tool_route_service import ToolRouteInput, ToolRoutePatch, providers

router = APIRouter(prefix="/v1", tags=["tools"])


@router.get("/tool-providers")
async def list_tool_providers(user_id: UserId) -> list[ToolProviderOut]:
    return [ToolProviderOut.model_validate(p) for p in providers()]


@router.get("/tool-routes")
async def list_tool_routes(user_id: UserId, services: ServicesDep) -> list[ToolRouteOut]:
    return [ToolRouteOut.model_validate(r) for r in await services.tool_routes.list(user_id)]


@router.post("/tool-routes", status_code=status.HTTP_201_CREATED)
async def create_tool_route(
    body: ToolRouteIn, user_id: UserId, services: ServicesDep
) -> ToolRouteOut:
    view = await services.tool_routes.create(
        user_id,
        ToolRouteInput(
            kind=body.kind,
            provider=body.provider,
            label=body.label,
            api_key=body.api_key,
            base_url=body.base_url,
            model=body.model,
            params=body.params,
            default=body.default,
        ),
    )
    return ToolRouteOut.model_validate(view)


@router.patch("/tool-routes/{route_id}")
async def update_tool_route(
    route_id: str, body: ToolRoutePatchIn, user_id: UserId, services: ServicesDep
) -> ToolRouteOut:
    view = await services.tool_routes.update(
        user_id,
        route_id,
        ToolRoutePatch(
            label=body.label,
            api_key=body.api_key or None,
            base_url=body.base_url or None,
            clear_base_url=body.base_url == "",
            model=body.model,
            params=body.params,
            default=body.default,
        ),
    )
    return ToolRouteOut.model_validate(view)


@router.delete("/tool-routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tool_route(route_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.tool_routes.delete(user_id, route_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/tool-routes/{route_id}/test")
async def test_tool_route(route_id: str, user_id: UserId, services: ServicesDep) -> ToolRouteOut:
    return ToolRouteOut.model_validate(await services.tool_routes.test(user_id, route_id))
