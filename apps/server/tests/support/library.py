"""测试用：导入一张卡（变成草稿）→ 保存进角色卡仓库，顺便建一个剧本。"""

from __future__ import annotations

from bettertavern.services.container import Services
from bettertavern.services.scenario_service import ScenarioView


async def import_scenario(services: Services, user_id: str, data: bytes) -> ScenarioView:
    imported = await services.drafts.import_file(
        user_id, data, language="zh", allow_duplicate=False
    )
    assert imported.draft is not None
    saved = await services.drafts.save(user_id, imported.draft.summary.id, new_scenario=True)
    assert saved.scenario is not None
    return saved.scenario
