"""剧本库：导入角色卡（multipart 上传 PNG 或 JSON）、列表、详情、改名、删除；头像。"""

from __future__ import annotations

from fastapi import APIRouter, File, Request, Response, UploadFile, status

from bettertavern.api.deps import ServicesDep, UserId
from bettertavern.api.schemas.story import ScenarioOut, ScenarioPatchIn
from bettertavern.importers.character_card import MAX_UPLOAD_BYTES
from bettertavern.services.errors import AppError

router = APIRouter(prefix="/v1", tags=["剧本库"])


@router.post("/scenarios/import", status_code=status.HTTP_201_CREATED)
async def import_scenario(
    response: Response,
    user_id: UserId,
    services: ServicesDep,
    file: UploadFile = File(...),  # noqa: B008
) -> ScenarioOut:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise AppError(
            f"文件超过 {MAX_UPLOAD_BYTES // (1024 * 1024)} MB", code="PAYLOAD_TOO_LARGE", status=413
        )
    view = await services.scenarios.import_file(user_id, data)
    if view.duplicate:
        response.status_code = status.HTTP_200_OK
    return ScenarioOut.model_validate(view)


@router.get("/scenarios")
async def list_scenarios(user_id: UserId, services: ServicesDep) -> list[ScenarioOut]:
    return [ScenarioOut.model_validate(s) for s in await services.scenarios.list(user_id)]


@router.get("/scenarios/{scenario_id}")
async def get_scenario(scenario_id: str, user_id: UserId, services: ServicesDep) -> ScenarioOut:
    return ScenarioOut.model_validate(await services.scenarios.get(user_id, scenario_id))


@router.patch("/scenarios/{scenario_id}")
async def rename_scenario(
    scenario_id: str, body: ScenarioPatchIn, user_id: UserId, services: ServicesDep
) -> ScenarioOut:
    return ScenarioOut.model_validate(
        await services.scenarios.rename(user_id, scenario_id, body.name)
    )


@router.delete("/scenarios/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scenario(scenario_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.scenarios.delete(user_id, scenario_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/blobs/{blob_id}", response_class=Response)
async def get_blob(
    blob_id: str, request: Request, user_id: UserId, services: ServicesDep
) -> Response:
    blob = await services.scenarios.blob(user_id, blob_id)
    etag = f'"{blob.sha256[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "private, max-age=86400"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=blob.data, media_type=blob.mime, headers=headers)
