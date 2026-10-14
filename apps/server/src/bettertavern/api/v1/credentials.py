"""服务商、凭据（密钥与端点）、探测、模型列表与模型路由。"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from bettertavern.api.deps import LimitersDep, ServicesDep, UserId, check_rate
from bettertavern.api.schemas.credentials import (
    CredentialIn,
    CredentialOut,
    CredentialPatchIn,
    ModelOut,
    ProbeIn,
    ProbeOut,
    ProviderOut,
    RouteIn,
    RouteOut,
)
from bettertavern.services.credential_service import CredentialInput, CredentialPatch

router = APIRouter(prefix="/v1", tags=["凭据与路由"])


@router.get("/providers")
async def providers(user_id: UserId, services: ServicesDep) -> list[ProviderOut]:
    return [ProviderOut.model_validate(p) for p in services.credentials.providers()]


@router.get("/credentials")
async def list_credentials(user_id: UserId, services: ServicesDep) -> list[CredentialOut]:
    return [CredentialOut.model_validate(c) for c in await services.credentials.list(user_id)]


@router.post("/credentials", status_code=status.HTTP_201_CREATED)
async def create_credential(
    body: CredentialIn, user_id: UserId, services: ServicesDep
) -> CredentialOut:
    view = await services.credentials.create(
        user_id,
        CredentialInput(
            provider=body.provider,
            label=body.label,
            api_key=body.api_key,
            base_url=body.base_url,
            extra_headers=body.extra_headers,
            extra_body=body.extra_body,
        ),
    )
    return CredentialOut.model_validate(view)


@router.get("/credentials/{credential_id}")
async def get_credential(
    credential_id: str, user_id: UserId, services: ServicesDep
) -> CredentialOut:
    return CredentialOut.model_validate(await services.credentials.get(user_id, credential_id))


@router.patch("/credentials/{credential_id}")
async def update_credential(
    credential_id: str, body: CredentialPatchIn, user_id: UserId, services: ServicesDep
) -> CredentialOut:
    view = await services.credentials.update(
        user_id,
        credential_id,
        CredentialPatch(
            label=body.label,
            api_key=body.api_key or None,
            base_url=body.base_url or None,
            clear_base_url=body.base_url == "",
            extra_headers=body.extra_headers,
            extra_body=body.extra_body,
        ),
    )
    return CredentialOut.model_validate(view)


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(credential_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.credentials.delete(user_id, credential_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/credentials/{credential_id}/probe")
async def probe_credential(
    credential_id: str,
    body: ProbeIn,
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
) -> ProbeOut:
    check_rate(limiters.probe, f"probe:{user_id}")
    report = await services.credentials.probe(user_id, credential_id, body.model)
    return ProbeOut.model_validate(report.to_json())


@router.get("/credentials/{credential_id}/models")
async def list_models(credential_id: str, user_id: UserId, services: ServicesDep) -> list[ModelOut]:
    models = await services.credentials.list_models(user_id, credential_id)
    return [ModelOut.model_validate(m) for m in models]


@router.get("/model-routes")
async def list_routes(user_id: UserId, services: ServicesDep) -> list[RouteOut]:
    return [RouteOut.model_validate(r) for r in await services.routes.list(user_id)]


@router.put("/model-routes/{task}")
async def put_route(task: str, body: RouteIn, user_id: UserId, services: ServicesDep) -> RouteOut:
    view = await services.routes.put(
        user_id,
        task,
        credential_id=body.credential_id,
        model=body.model,
        params=body.params.model_dump(exclude_none=True),
        caps_override=body.caps_override,
        fallback_route_id=body.fallback_route_id,
    )
    return RouteOut.model_validate(view)


@router.delete("/model-routes/{task}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_route(task: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.routes.delete(user_id, task)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
