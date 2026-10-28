"""人设库（F3，docs/personas.md）：列表、新建、修改、删除、换头像、导入 SillyTavern 的人设备份。"""

from __future__ import annotations

from fastapi import APIRouter, File, Response, UploadFile, status

from bettertavern.api.deps import LimitersDep, ServicesDep, UserId, check_rate
from bettertavern.api.schemas.personas import (
    PersonaImportOut,
    PersonaIn,
    PersonaOut,
    PersonaPatchIn,
)
from bettertavern.importers.images import MAX_IMAGE_BYTES
from bettertavern.importers.persona import MAX_BACKUP_BYTES
from bettertavern.services.errors import AppError

router = APIRouter(prefix="/v1", tags=["personas"])

# 上传的头像和备份文件，加上 multipart 的边界和头
AVATAR_PATH_PATTERN = r"^/v1/personas/[^/]+/avatar$"
MAX_AVATAR_BODY_BYTES = MAX_IMAGE_BYTES + 256 * 1024
IMPORT_PATH = "/v1/personas/import"
MAX_IMPORT_BODY_BYTES = MAX_BACKUP_BYTES + 256 * 1024


def _limit(limiters: LimitersDep, user_id: str) -> None:
    """上传头像、导入占地方：和工作台的导入、上传共用一个计数。"""
    check_rate(limiters.workbench, f"workbench:{user_id}")


async def _read(file: UploadFile, limit: int) -> bytes:
    data = await file.read(limit + 1)
    await file.close()
    if len(data) > limit:
        raise AppError(
            f"File exceeds {limit // (1024 * 1024)} MB", code="PAYLOAD_TOO_LARGE", status=413
        )
    return data


@router.get("/personas")
async def list_personas(user_id: UserId, services: ServicesDep) -> list[PersonaOut]:
    return [PersonaOut.model_validate(p) for p in await services.personas.list(user_id)]


@router.post("/personas", status_code=status.HTTP_201_CREATED)
async def create_persona(body: PersonaIn, user_id: UserId, services: ServicesDep) -> PersonaOut:
    persona = await services.personas.create(
        user_id, name=body.name, description=body.description, is_default=body.is_default
    )
    return PersonaOut.model_validate(persona)


@router.post("/personas/import", status_code=status.HTTP_201_CREATED)
async def import_personas(
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
    file: UploadFile = File(...),  # noqa: B008
) -> PersonaImportOut:
    _limit(limiters, user_id)
    result = await services.personas.import_backup(user_id, await _read(file, MAX_BACKUP_BYTES))
    return PersonaImportOut(
        personas=[PersonaOut.model_validate(p) for p in result.personas],
        created=result.created,
        skipped=result.skipped,
    )


@router.patch("/personas/{persona_id}")
async def update_persona(
    persona_id: str, body: PersonaPatchIn, user_id: UserId, services: ServicesDep
) -> PersonaOut:
    persona = await services.personas.update(
        user_id,
        persona_id,
        name=body.name,
        description=body.description,
        is_default=body.is_default,
    )
    return PersonaOut.model_validate(persona)


@router.delete("/personas/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_persona(persona_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.personas.delete(user_id, persona_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/personas/{persona_id}/avatar")
async def set_persona_avatar(
    persona_id: str,
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
    file: UploadFile = File(...),  # noqa: B008
) -> PersonaOut:
    _limit(limiters, user_id)
    data = await _read(file, MAX_IMAGE_BYTES)
    return PersonaOut.model_validate(await services.personas.set_avatar(user_id, persona_id, data))


@router.delete("/personas/{persona_id}/avatar")
async def remove_persona_avatar(
    persona_id: str, user_id: UserId, services: ServicesDep
) -> PersonaOut:
    return PersonaOut.model_validate(await services.personas.remove_avatar(user_id, persona_id))
