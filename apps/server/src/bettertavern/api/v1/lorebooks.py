"""世界书仓库（docs/lorebook.md）：列表、导入、新建、详情、改名和简介、改条目、删除。"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, Response, UploadFile, status

from bettertavern.api.deps import LimitersDep, ServicesDep, UserId, check_rate
from bettertavern.api.schemas.library import LoreEntryOut, ScenarioRefOut, lore_edit
from bettertavern.api.schemas.lorebooks import (
    LorebookBookIn,
    LorebookCreateIn,
    LorebookDetailOut,
    LorebookImportOut,
    LorebookOut,
    LorebookPatchIn,
)
from bettertavern.importers.lorebook import MAX_UPLOAD_BYTES
from bettertavern.services.errors import AppError
from bettertavern.services.lorebook_service import LorebookDetail

router = APIRouter(prefix="/v1", tags=["library"])

# 导入的文件最大 8 MB，加上 multipart 的边界和头
IMPORT_PATH = "/v1/lorebooks/import"
MAX_IMPORT_BODY_BYTES = MAX_UPLOAD_BYTES + 256 * 1024
# 改条目时整本发过来：最多 50 万字，中文按 UTF-8 约 1.5 MB，再加上 2000 条的字段名、引号和转义
BOOK_PATH_PATTERN = r"^/v1/lorebooks/[^/]+/book$"
MAX_BOOK_BODY_BYTES = 8 * 1024 * 1024


def detail_out(detail: LorebookDetail) -> LorebookDetailOut:
    return LorebookDetailOut(
        lorebook=LorebookOut.model_validate(detail.summary),
        book=[LoreEntryOut.model_validate(e) for e in detail.book],
        scenarios=[ScenarioRefOut(id=sid, name=name) for sid, name in detail.scenarios],
    )


def _limit(limiters: LimitersDep, user_id: str) -> None:
    """导入、新建占地方：和工作台的导入、上传共用一个计数。"""
    check_rate(limiters.workbench, f"workbench:{user_id}")


@router.get("/lorebooks")
async def list_lorebooks(user_id: UserId, services: ServicesDep) -> list[LorebookOut]:
    return [LorebookOut.model_validate(b) for b in await services.lorebooks.list(user_id)]


@router.post("/lorebooks", status_code=status.HTTP_201_CREATED)
async def create_lorebook(
    body: LorebookCreateIn, user_id: UserId, services: ServicesDep, limiters: LimitersDep
) -> LorebookDetailOut:
    _limit(limiters, user_id)
    detail = await services.lorebooks.create(user_id, name=body.name, description=body.description)
    return detail_out(detail)


@router.post("/lorebooks/import", status_code=status.HTTP_201_CREATED)
async def import_lorebook(
    response: Response,
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
    file: UploadFile = File(...),  # noqa: B008
    allow_duplicate: bool = Form(False),
) -> LorebookImportOut:
    _limit(limiters, user_id)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    filename = file.filename or ""
    await file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise AppError(
            f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
            code="PAYLOAD_TOO_LARGE",
            status=413,
        )
    result = await services.lorebooks.import_file(
        user_id, data, filename=filename, allow_duplicate=allow_duplicate
    )
    if result.lorebook is None:
        response.status_code = status.HTTP_200_OK
    return LorebookImportOut(
        lorebook=detail_out(result.lorebook) if result.lorebook is not None else None,
        existing=LorebookOut.model_validate(result.existing) if result.existing else None,
    )


@router.get("/lorebooks/{lorebook_id}")
async def get_lorebook(
    lorebook_id: str, user_id: UserId, services: ServicesDep
) -> LorebookDetailOut:
    return detail_out(await services.lorebooks.get(user_id, lorebook_id))


@router.patch("/lorebooks/{lorebook_id}")
async def update_lorebook(
    lorebook_id: str, body: LorebookPatchIn, user_id: UserId, services: ServicesDep
) -> LorebookDetailOut:
    detail = await services.lorebooks.update_meta(
        user_id,
        lorebook_id,
        name=body.name,
        description=body.description,
        version=body.version,
    )
    return detail_out(detail)


@router.put("/lorebooks/{lorebook_id}/book")
async def update_lorebook_book(
    lorebook_id: str, body: LorebookBookIn, user_id: UserId, services: ServicesDep
) -> LorebookDetailOut:
    detail = await services.lorebooks.update_book(
        user_id, lorebook_id, version=body.version, entries=[lore_edit(e) for e in body.book]
    )
    return detail_out(detail)


@router.delete("/lorebooks/{lorebook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lorebook(lorebook_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.lorebooks.delete(user_id, lorebook_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
