"""服务商、模型列表、模型路由（玩家配好的模型）与测试。"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from bettertavern.api.deps import LimitersDep, ServicesDep, UserId, check_rate
from bettertavern.api.schemas.routes import (
    ModelListIn,
    ModelOut,
    ProbeOut,
    ProviderOut,
    RouteIn,
    RouteOut,
    RoutePatchIn,
)
from bettertavern.services.route_inputs import RouteInput, RoutePatch

router = APIRouter(prefix="/v1", tags=["models"])


@router.get("/providers")
async def providers(user_id: UserId, services: ServicesDep) -> list[ProviderOut]:
    return [ProviderOut.model_validate(p) for p in services.routes.providers()]


@router.post("/providers/{provider}/models")
async def preview_models(
    provider: str,
    body: ModelListIn,
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
) -> list[ModelOut]:
    check_rate(limiters.probe, f"models:{user_id}")
    models = await services.routes.preview_models(
        user_id,
        provider,
        api_key=body.api_key,
        copy_key_from=body.copy_key_from,
        base_url=body.base_url,
    )
    return [ModelOut.model_validate(m) for m in models]


@router.get("/model-routes")
async def list_routes(user_id: UserId, services: ServicesDep) -> list[RouteOut]:
    return [RouteOut.model_validate(r) for r in await services.routes.list(user_id)]


@router.post("/model-routes", status_code=status.HTTP_201_CREATED)
async def create_route(body: RouteIn, user_id: UserId, services: ServicesDep) -> RouteOut:
    view = await services.routes.create(
        user_id,
        RouteInput(
            provider=body.provider,
            model=body.model,
            label=body.label,
            api_key=body.api_key,
            copy_key_from=body.copy_key_from,
            base_url=body.base_url,
            extra_headers=body.extra_headers,
            extra_body=body.extra_body,
            manual_window=body.manual_window,
            params=body.params.model_dump(exclude_none=True),
            caps_override=body.caps_override,
            director=body.director,
            background=body.background,
        ),
    )
    return RouteOut.model_validate(view)


@router.get("/model-routes/{route_id}")
async def get_route(route_id: str, user_id: UserId, services: ServicesDep) -> RouteOut:
    return RouteOut.model_validate(await services.routes.get(user_id, route_id))


@router.patch("/model-routes/{route_id}")
async def update_route(
    route_id: str, body: RoutePatchIn, user_id: UserId, services: ServicesDep
) -> RouteOut:
    given = body.model_fields_set
    view = await services.routes.update(
        user_id,
        route_id,
        RoutePatch(
            label=body.label,
            model=body.model,
            api_key=body.api_key or None,
            apply_to_same_key=body.apply_to_same_key,
            base_url=body.base_url or None,
            clear_base_url=body.base_url == "",
            extra_headers=body.extra_headers,
            extra_body=body.extra_body,
            manual_window=body.manual_window,
            clear_manual_window="manual_window" in given and body.manual_window is None,
            params=None if body.params is None else body.params.model_dump(exclude_none=True),
            caps_override=body.caps_override,
            director=body.director,
            background=body.background,
        ),
    )
    return RouteOut.model_validate(view)


@router.delete("/model-routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_route(route_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.routes.delete(user_id, route_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/model-routes/{route_id}/probe")
async def probe_route(
    route_id: str, user_id: UserId, services: ServicesDep, limiters: LimitersDep
) -> ProbeOut:
    check_rate(limiters.probe, f"probe:{user_id}")
    report = await services.routes.probe(user_id, route_id)
    return ProbeOut.model_validate(report.to_json())


@router.get("/model-routes/{route_id}/models")
async def list_models(route_id: str, user_id: UserId, services: ServicesDep) -> list[ModelOut]:
    models = await services.routes.list_models(user_id, route_id)
    return [ModelOut.model_validate(m) for m in models]
