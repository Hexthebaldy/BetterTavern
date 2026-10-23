"""点数：官方模型的余额和估计还能写多少回合。"""

from __future__ import annotations

from fastapi import APIRouter

from bettertavern.api.deps import ServicesDep, UserId
from bettertavern.api.schemas.credits import CreditsOut

router = APIRouter(prefix="/v1", tags=["account"])


@router.get("/me/credits")
async def my_credits(user_id: UserId, services: ServicesDep) -> CreditsOut:
    return CreditsOut.model_validate(await services.credits.view(user_id))
