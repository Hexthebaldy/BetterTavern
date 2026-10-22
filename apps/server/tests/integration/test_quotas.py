"""每个用户的用量上限：同时在写的 agent、没保存的草稿、存的图一共多大（真实 Postgres）。"""

from __future__ import annotations

import asyncio
import io
from collections.abc import AsyncIterator

import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.tokens import AccessTokenSigner
from bettertavern.runtime.ports import NewImage, StorageFull
from bettertavern.services.auth_service import AuthService
from bettertavern.services.draft_service import DraftService
from bettertavern.services.errors import AppError
from bettertavern.services.quotas import Quotas
from bettertavern.services.scenario_service import ScenarioService
from bettertavern.services.web_store import PgWebStore
from bettertavern.services.workbench_service import WorkbenchService
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    assert URL is not None
    async with schema_engine(URL) as engine:
        yield engine


async def new_user(engine: AsyncEngine, email: str = "lin@example.com") -> str:
    auth = AuthService(engine, AccessTokenSigner(b"k" * 40, ttl_s=900), refresh_ttl_s=3600)
    user, _ = await auth.register(email, "correct horse")
    return user.id


def drafts(engine: AsyncEngine, quotas: Quotas) -> DraftService:
    return DraftService(engine, ScenarioService(engine), quotas)


def png(color: tuple[int, int, int] = (200, 30, 30)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 96), color).save(out, format="PNG")
    return out.getvalue()


async def used_bytes(engine: AsyncEngine, user_id: str) -> int:
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT COALESCE(SUM(size), 0) FROM blobs WHERE user_id = :u"), {"u": user_id}
        )
        return int(result.scalar_one())


async def test_unsaved_drafts_are_capped(engine: AsyncEngine) -> None:
    user = await new_user(engine)
    other = await new_user(engine, "zhou@example.com")
    service = drafts(engine, Quotas(max_open_drafts=2))
    # 同时点了三次“新建”：排队检查，只有两份建得出来
    results = await asyncio.gather(
        *(service.create_manual(user, language="zh") for _ in range(3)), return_exceptions=True
    )
    made = [r for r in results if not isinstance(r, BaseException)]
    refused = [r for r in results if isinstance(r, AppError)]
    assert len(made) == 2 and len(refused) == 1
    assert refused[0].code == "TOO_MANY_DRAFTS" and refused[0].status == 409
    # 从聊天框开始也算；别人的不算
    with pytest.raises(AppError) as again:
        await WorkbenchService(engine, quotas=Quotas(max_open_drafts=2)).start(
            user, text="写一张卡", language="zh"
        )
    assert again.value.code == "TOO_MANY_DRAFTS"
    await service.create_manual(other, language="zh")
    # 删掉一份就又能建
    await service.delete(user, made[0].summary.id)
    await service.create_manual(user, language="zh")


async def test_running_agents_are_capped(engine: AsyncEngine) -> None:
    user = await new_user(engine)
    workbench = WorkbenchService(engine, quotas=Quotas(max_running_agents=2))
    try:
        # 没有 worker 领任务，开出来的两轮一直算“正在写”
        first = await workbench.start(user, text="写一张卡", language="zh")
        await workbench.start(user, text="再写一张", language="zh")
        with pytest.raises(AppError) as busy:
            await workbench.start(user, text="第三张", language="zh")
        assert busy.value.code == "TOO_MANY_RUNS"
        # 心跳过期的（worker 意外退出）不算
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    """UPDATE workbench_drafts SET run_heartbeat_at = now() - interval '1 hour'
                       WHERE id = :d"""
                ),
                {"d": first.summary.id},
            )
        await workbench.start(user, text="第三张", language="zh")
    finally:
        await workbench.aclose()


async def test_image_storage_is_capped(engine: AsyncEngine) -> None:
    user = await new_user(engine)
    roomy = drafts(engine, Quotas())
    view = await roomy.create_manual(user, language="zh")
    await roomy.upload_asset(user, view.summary.id, png())
    used = await used_bytes(engine, user)
    assert used > 0
    # 只剩不到一张图的地方：上传被拒，已经存的不受影响
    tight = Quotas(max_image_bytes=used + 10)
    with pytest.raises(AppError) as full:
        await drafts(engine, tight).upload_asset(user, view.summary.id, png((10, 200, 10)))
    assert full.value.code == "STORAGE_FULL" and full.value.status == 409
    assert await used_bytes(engine, user) == used
    # agent 搜到、生成的图走 WebStore：存不下时抛 StorageFull，由 agent 告诉用户
    image = NewImage(data=b"x" * 64, mime="image/png", width=1, height=1, sha256="0" * 64)
    with pytest.raises(StorageFull):
        await PgWebStore(engine, Quotas(max_image_bytes=used + 10)).add_image(
            user, view.summary.id, image, source="search", license="unknown"
        )
    await PgWebStore(engine, Quotas()).add_image(
        user, view.summary.id, image, source="search", license="unknown"
    )
