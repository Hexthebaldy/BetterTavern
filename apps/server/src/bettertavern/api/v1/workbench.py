"""工作台：草稿（新建、导入文件、自动保存、切模式）、草稿里的图片和封面、保存到角色卡仓库、删除；
agent 模式的对话、问卷、方案、改动对比、停止、接着写，以及推送事件（SSE）。"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, File, Form, Header, Request, Response, UploadFile, status
from starlette.responses import StreamingResponse

from bettertavern.api.deps import ServicesDep, UserId
from bettertavern.api.lifecycle import Shutdown
from bettertavern.api.schemas.library import CardOut, CharacterCardIn, CharacterCardOut, ScenarioOut
from bettertavern.api.schemas.workbench import (
    AssetOut,
    ChangesDecisionIn,
    ChangesDecisionOut,
    CoverGenerateIn,
    DraftCardIn,
    DraftCoverIn,
    DraftCreateIn,
    DraftImportOut,
    DraftOut,
    DraftPatchIn,
    DraftSaveIn,
    DraftSaveOut,
    DraftSummaryOut,
    IssueOut,
    MessageIn,
    MessageOut,
    NoteOut,
    StopOut,
    TranscriptOut,
)
from bettertavern.api.sse import event_stream_body, sse_response
from bettertavern.domain.scenario.edit import CardEdit, LoreEntryEdit
from bettertavern.domain.story.language import DEFAULT_LANGUAGE, parse_language
from bettertavern.importers.character_card import MAX_UPLOAD_BYTES
from bettertavern.importers.images import MAX_IMAGE_BYTES
from bettertavern.services.cover_service import CoverRequest
from bettertavern.services.draft_service import DraftView
from bettertavern.services.errors import AppError, Invalid

router = APIRouter(prefix="/v1/workbench", tags=["workbench"])

# 自动保存整张卡：一张卡最多 30 万字，中文按 UTF-8 接近 1 MB，再加上 JSON 的引号和转义
MAX_CARD_BODY_BYTES = 4 * 1024 * 1024
CARD_PATH_PATTERN = r"^/v1/workbench/drafts/[^/]+/card$"
ASSET_PATH_PATTERN = r"^/v1/workbench/drafts/[^/]+/assets$"
IMPORT_PATH = "/v1/workbench/drafts/import"


def draft_out(view: DraftView) -> DraftOut:
    return DraftOut(
        draft=DraftSummaryOut.model_validate(view.summary),
        card=CharacterCardOut.model_validate(view.card),
        cover_asset_id=view.cover_asset_id,
        base_version=view.base_version,
        todos=view.todos,
        language=view.language,
        issues=[IssueOut.model_validate(i) for i in view.issues],
        assets=[AssetOut.model_validate(a) for a in view.assets],
        notes=[NoteOut.model_validate(n) for n in view.notes],
    )


def card_edit(card: CharacterCardIn) -> CardEdit:
    return CardEdit(
        name=card.name,
        description=card.description,
        personality=card.personality,
        scenario=card.scenario,
        first_mes=card.first_mes,
        mes_example=card.mes_example,
        system_prompt=card.system_prompt,
        creator_notes=card.creator_notes,
        alternate_greetings=tuple(card.alternate_greetings),
        tags=tuple(card.tags),
        book=tuple(
            LoreEntryEdit(
                name=e.name,
                keys=tuple(e.keys),
                content=e.content,
                enabled=e.enabled,
                constant=e.constant,
            )
            for e in card.book
        ),
    )


async def _read_upload(file: UploadFile, limit: int) -> bytes:
    data = await file.read(limit + 1)
    await file.close()
    if len(data) > limit:
        raise AppError(
            f"File exceeds {limit // (1024 * 1024)} MB", code="PAYLOAD_TOO_LARGE", status=413
        )
    return data


@router.post("/drafts", status_code=status.HTTP_201_CREATED)
async def create_draft(body: DraftCreateIn, user_id: UserId, services: ServicesDep) -> DraftOut:
    if body.origin == "edit_card":
        if not body.card_id:
            raise Invalid("card_id is required to open a card", field="card_id")
        view = await services.drafts.open_card(user_id, body.card_id, language=body.language)
    elif body.origin == "agent":
        text = (body.text or "").strip()
        if not text:
            raise Invalid("Say what you'd like to make", field="text")
        view = await services.workbench.start(user_id, text=text, language=body.language)
    else:
        view = await services.drafts.create_manual(user_id, language=body.language)
    return draft_out(view)


@router.post("/drafts/import", status_code=status.HTTP_201_CREATED)
async def import_draft(
    response: Response,
    user_id: UserId,
    services: ServicesDep,
    file: UploadFile = File(...),  # noqa: B008
    language: str = Form(DEFAULT_LANGUAGE),
    allow_duplicate: bool = Form(False),
) -> DraftImportOut:
    data = await _read_upload(file, MAX_UPLOAD_BYTES)
    result = await services.drafts.import_file(
        user_id, data, language=parse_language(language), allow_duplicate=allow_duplicate
    )
    if result.draft is None:
        response.status_code = status.HTTP_200_OK
    return DraftImportOut(
        draft=draft_out(result.draft) if result.draft is not None else None,
        existing_card=(
            CardOut.model_validate(result.existing_card) if result.existing_card else None
        ),
    )


@router.get("/drafts")
async def list_drafts(user_id: UserId, services: ServicesDep) -> list[DraftSummaryOut]:
    return [DraftSummaryOut.model_validate(d) for d in await services.drafts.list(user_id)]


@router.get("/drafts/{draft_id}")
async def get_draft(draft_id: str, user_id: UserId, services: ServicesDep) -> DraftOut:
    return draft_out(await services.drafts.get(user_id, draft_id))


@router.put("/drafts/{draft_id}/card")
async def update_draft_card(
    draft_id: str, body: DraftCardIn, user_id: UserId, services: ServicesDep
) -> DraftOut:
    view = await services.drafts.update_card(
        user_id, draft_id, version=body.version, name=body.name, edit=card_edit(body.card)
    )
    return draft_out(view)


@router.patch("/drafts/{draft_id}")
async def update_draft(
    draft_id: str, body: DraftPatchIn, user_id: UserId, services: ServicesDep
) -> DraftOut:
    if body.mode == "manual":
        # 切到手动接管：agent 正在跑就让它做完手上这一步停下
        await services.workbench.stop(user_id, draft_id)
    return draft_out(await services.drafts.set_mode(user_id, draft_id, body.mode))


@router.post("/drafts/{draft_id}/assets", status_code=status.HTTP_201_CREATED)
async def upload_draft_asset(
    draft_id: str,
    user_id: UserId,
    services: ServicesDep,
    file: UploadFile = File(...),  # noqa: B008
) -> AssetOut:
    data = await _read_upload(file, MAX_IMAGE_BYTES)
    return AssetOut.model_validate(await services.drafts.upload_asset(user_id, draft_id, data))


@router.post("/drafts/{draft_id}/covers", status_code=status.HTTP_201_CREATED)
async def generate_draft_covers(
    draft_id: str, body: CoverGenerateIn, user_id: UserId, services: ServicesDep
) -> list[AssetOut]:
    assets = await services.covers.generate(
        user_id,
        draft_id,
        CoverRequest(prompt=body.prompt, style=body.style, count=body.count, aspect=body.aspect),
    )
    return [AssetOut.model_validate(a) for a in assets]


@router.put("/drafts/{draft_id}/cover")
async def set_draft_cover(
    draft_id: str, body: DraftCoverIn, user_id: UserId, services: ServicesDep
) -> DraftOut:
    view = await services.drafts.set_cover(
        user_id, draft_id, body.asset_id, personal_use=body.personal_use
    )
    return draft_out(view)


@router.post("/drafts/{draft_id}/save")
async def save_draft(
    draft_id: str, body: DraftSaveIn, user_id: UserId, services: ServicesDep
) -> DraftSaveOut:
    result = await services.drafts.save(
        user_id, draft_id, new_scenario=body.new_scenario, on_conflict=body.on_conflict
    )
    return DraftSaveOut(
        card=CardOut.model_validate(result.card),
        draft=draft_out(result.draft),
        scenario=ScenarioOut.model_validate(result.scenario) if result.scenario else None,
    )


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(draft_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.workbench.stop(user_id, draft_id, quiet=True)
    await services.drafts.delete(user_id, draft_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/drafts/{draft_id}/messages")
async def list_draft_messages(
    draft_id: str, user_id: UserId, services: ServicesDep
) -> TranscriptOut:
    transcript = await services.workbench.transcript(user_id, draft_id)
    return TranscriptOut(
        messages=[MessageOut.model_validate(m) for m in transcript.messages],
        last_event_id=transcript.last_event_id,
    )


@router.post("/drafts/{draft_id}/messages", status_code=status.HTTP_201_CREATED)
async def post_draft_message(
    draft_id: str, body: MessageIn, user_id: UserId, services: ServicesDep
) -> MessageOut:
    if body.kind == "text":
        payload: dict[str, object] = {"text": body.text or ""}
    elif body.kind == "answers":
        payload = {"answers": body.answers or {}, "delegated": body.delegated}
    else:
        payload = {"approved": bool(body.approved), "name": body.name, "text": body.text}
    message = await services.workbench.post(user_id, draft_id, body.kind, payload)
    return MessageOut.model_validate(message)


@router.post("/drafts/{draft_id}/changes/{seq}")
async def decide_draft_changes(
    draft_id: str, seq: int, body: ChangesDecisionIn, user_id: UserId, services: ServicesDep
) -> ChangesDecisionOut:
    message, draft = await services.workbench.decide(
        user_id,
        draft_id,
        seq,
        accept=body.accept,
        reject=body.reject,
        accept_all=body.all == "accept",
        reject_all=body.all == "reject",
    )
    return ChangesDecisionOut(message=MessageOut.model_validate(message), draft=draft_out(draft))


@router.post("/drafts/{draft_id}/stop")
async def stop_draft_agent(draft_id: str, user_id: UserId, services: ServicesDep) -> StopOut:
    return StopOut(stopped=await services.workbench.stop(user_id, draft_id))


@router.post("/drafts/{draft_id}/continue")
async def continue_draft_agent(draft_id: str, user_id: UserId, services: ServicesDep) -> DraftOut:
    return draft_out(await services.workbench.continue_(user_id, draft_id))


@router.get("/drafts/{draft_id}/events", response_class=StreamingResponse)
async def draft_events(
    draft_id: str,
    request: Request,
    user_id: UserId,
    services: ServicesDep,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    after = parse_event_id(last_event_id, draft_id)
    structlog.contextvars.bind_contextvars(draft_id=draft_id)
    events = await services.workbench.events(user_id, draft_id, after=after)
    shutdown: Shutdown | None = getattr(request.app.state, "shutdown", None)
    return sse_response(
        event_stream_body(
            events, stop=shutdown.event if shutdown is not None else None, resumed_from=after
        )
    )


def parse_event_id(value: str | None, draft_id: str) -> int:
    """Last-Event-ID 是 {草稿 id}:{事件编号}；也接受只有编号
    （客户端从对话记录的 last_event_id 开始订阅）。"""
    if not value:
        return 0
    text = value.strip()
    if text.isdigit():
        return int(text)
    prefix, sep, number = text.rpartition(":")
    if sep and prefix == draft_id and number.isdigit():
        return int(number)
    return 0
