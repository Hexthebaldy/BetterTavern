"""角色卡仓库：列表、详情、删除、版本历史和恢复、导出；图片（封面）。"""

from __future__ import annotations

from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Query, Request, Response, status

from bettertavern.api.deps import ServicesDep, UserId
from bettertavern.api.schemas.library import (
    CardDetailOut,
    CardOut,
    CardRevisionOut,
    CardSourceOut,
    CharacterCardOut,
    ScenarioRefOut,
)
from bettertavern.services.card_service import CardDetail

router = APIRouter(prefix="/v1", tags=["library"])


def detail_out(detail: CardDetail) -> CardDetailOut:
    sources = detail.meta.get("sources")
    return CardDetailOut(
        card=CardOut.model_validate(detail.summary),
        content=CharacterCardOut.model_validate(detail.card),
        sources=[
            CardSourceOut.model_validate(s)
            for s in (sources if isinstance(sources, list) else [])
            if isinstance(s, dict) and s.get("url")
        ],
        scenarios=[ScenarioRefOut(id=sid, name=name) for sid, name in detail.scenarios],
    )


@router.get("/cards")
async def list_cards(user_id: UserId, services: ServicesDep) -> list[CardOut]:
    return [CardOut.model_validate(c) for c in await services.cards.list(user_id)]


@router.get("/cards/{card_id}")
async def get_card(card_id: str, user_id: UserId, services: ServicesDep) -> CardDetailOut:
    return detail_out(await services.cards.get(user_id, card_id))


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(card_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.cards.delete(user_id, card_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/cards/{card_id}/revisions")
async def list_card_revisions(
    card_id: str, user_id: UserId, services: ServicesDep
) -> list[CardRevisionOut]:
    return [
        CardRevisionOut.model_validate(r) for r in await services.cards.revisions(user_id, card_id)
    ]


@router.post("/cards/{card_id}/revisions/{version}/restore")
async def restore_card_revision(
    card_id: str, version: int, user_id: UserId, services: ServicesDep
) -> CardDetailOut:
    return detail_out(await services.cards.restore(user_id, card_id, version))


@router.get("/cards/{card_id}/export", response_class=Response)
async def export_card(
    card_id: str,
    user_id: UserId,
    services: ServicesDep,
    fmt: Literal["png", "json"] = Query(default="png", alias="format"),
) -> Response:
    exported = await services.cards.export(user_id, card_id, fmt)
    disposition = f"attachment; filename*=UTF-8''{quote(exported.filename)}"
    return Response(
        content=exported.data,
        media_type=exported.mime,
        headers={"Content-Disposition": disposition, "Cache-Control": "no-store"},
    )


@router.get("/blobs/{blob_id}", response_class=Response)
async def get_blob(
    blob_id: str, request: Request, user_id: UserId, services: ServicesDep
) -> Response:
    blob = await services.cards.blob(user_id, blob_id)
    etag = f'"{blob.sha256[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "private, max-age=86400"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=blob.data, media_type=blob.mime, headers=headers)
