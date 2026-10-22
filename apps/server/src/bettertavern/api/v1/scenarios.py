"""剧本仓库：从角色卡仓库选一张或几张卡新建剧本，列表、详情、改名字和设置、换卡、删除。"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from bettertavern.api.deps import ServicesDep, UserId
from bettertavern.api.schemas.library import ScenarioIn, ScenarioOut, ScenarioPatchIn, setup_json
from bettertavern.services.scenario_service import ScenarioPatch

router = APIRouter(prefix="/v1", tags=["library"])


@router.get("/scenarios")
async def list_scenarios(user_id: UserId, services: ServicesDep) -> list[ScenarioOut]:
    return [ScenarioOut.model_validate(s) for s in await services.scenarios.list(user_id)]


@router.post("/scenarios", status_code=status.HTTP_201_CREATED)
async def create_scenario(body: ScenarioIn, user_id: UserId, services: ServicesDep) -> ScenarioOut:
    view = await services.scenarios.create(
        user_id, name=body.name, card_ids=body.card_ids, setup=setup_json(body.setup)
    )
    return ScenarioOut.model_validate(view)


@router.get("/scenarios/{scenario_id}")
async def get_scenario(scenario_id: str, user_id: UserId, services: ServicesDep) -> ScenarioOut:
    return ScenarioOut.model_validate(await services.scenarios.get(user_id, scenario_id))


@router.patch("/scenarios/{scenario_id}")
async def update_scenario(
    scenario_id: str, body: ScenarioPatchIn, user_id: UserId, services: ServicesDep
) -> ScenarioOut:
    patch = ScenarioPatch(
        name=body.name,
        setup=setup_json(body.setup) if body.setup is not None else None,
        card_ids=body.card_ids,
        version=body.version,
    )
    return ScenarioOut.model_validate(await services.scenarios.update(user_id, scenario_id, patch))


@router.delete("/scenarios/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scenario(scenario_id: str, user_id: UserId, services: ServicesDep) -> Response:
    await services.scenarios.delete(user_id, scenario_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
