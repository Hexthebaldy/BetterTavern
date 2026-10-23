"""工作台联网和出图：外部服务的配置（加密、默认、测试）、
agent 查资料（搜索、读网页走缓存、记笔记、存图）、
按方案生成封面、封面面板直接出图、保存时资料来源写进作者备注。

真实 Postgres；模型是可编排的假模型，联网和出图是假的 HTTP（不连外网）。
"""

from __future__ import annotations

import base64
import io
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy, ToolCall
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.ports import ToolConfig
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.runtime.workbench_runner import WorkbenchRunner
from bettertavern.services.container import Services, build_services, build_workbench_runner
from bettertavern.services.cover_service import CoverRequest
from bettertavern.services.errors import AppError
from bettertavern.services.quotas import Quotas
from bettertavern.services.route_inputs import RouteInput
from bettertavern.services.tool_route_service import ToolRouteInput, ToolRoutePatch
from tests.fakes.runtime import ScriptedAdapter, StreamScript, scripted_hub
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


def png(color: tuple[int, int, int] = (200, 30, 30), size: tuple[int, int] = (64, 96)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return out.getvalue()


WIKI = (
    """<html><head><title>林黛玉</title></head><body><article><h1>林黛玉</h1>
<p>林黛玉，《红楼梦》女主角，金陵十二钗之首，寄居荣国府。</p><p>"""
    + "她葬花吟诗。" * 30
    + """</p>
</article></body></html>"""
)


@dataclass
class FakeWeb:
    """假的外网：Tavily 的接口、维基百科的搜索接口、几个网页、一张图、一个出图服务。
    tavily_status 不是 200 时，Tavily 的搜索按这个状态码报错（432 是免费额度用完）。"""

    requests: list[str] = field(default_factory=list)
    tavily_status: int = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(f"{request.method} {request.url.host}{request.url.path}")
        host, path = request.url.host, request.url.path
        if host.endswith("wikipedia.org") and path == "/w/api.php":
            item = {"title": "林黛玉", "snippet": "金陵十二钗之首"}
            return httpx.Response(200, json={"query": {"search": [item]}})
        if host == "api.tavily.com" and self.tavily_status != 200:
            return httpx.Response(self.tavily_status, json={"detail": "usage limit"})
        if host == "api.tavily.com" and path == "/search":
            body = json.loads(request.content)
            if body.get("include_images"):
                return httpx.Response(
                    200, json={"results": [], "images": ["https://upload.wikimedia.org/lin.png"]}
                )
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "title": "林黛玉 - 维基百科",
                            "url": "https://zh.wikipedia.org/wiki/lin",
                            "content": "金陵十二钗之首",
                        }
                    ]
                },
            )
        if host == "zh.wikipedia.org":
            return httpx.Response(
                200, text=WIKI, headers={"content-type": "text/html; charset=utf-8"}
            )
        if host == "upload.wikimedia.org":
            return httpx.Response(200, content=png(), headers={"content-type": "image/png"})
        if host == "api.openai.com" and path == "/v1/images/generations":
            body = json.loads(request.content)
            data = [
                {"b64_json": base64.b64encode(png((10, 10, 200))).decode()}
                for _ in range(body["n"])
            ]
            return httpx.Response(200, json={"data": data})
        return httpx.Response(404)


@dataclass
class Bench:
    services: Services
    runner: WorkbenchRunner
    adapter: ScriptedAdapter
    engine: AsyncEngine
    user_id: str
    web: FakeWeb


@asynccontextmanager
async def bench(
    tmp_path: Path, *, platform_search: ToolConfig | None = None, quotas: Quotas | None = None
) -> AsyncIterator[Bench]:
    url = database_url()
    assert url is not None
    async with schema_engine(url, pool_size=10) as engine:
        hub, adapters = scripted_hub("fake")
        web = FakeWeb()
        http = httpx.AsyncClient(transport=httpx.MockTransport(web.handler))
        secrets = load_secrets(
            master_keys=new_master_key_entry("t1"),
            auth_secret="s" * 40,
            allow_dev_fallback=False,
            data_dir=tmp_path,
        )
        services = build_services(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            buffers=EventBufferRegistry(),
            access_ttl_s=900,
            refresh_ttl_s=3600,
            runner_config=RunnerConfig(),
            instance_id="test",
            http=http,
        )
        runner = build_workbench_runner(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            http=http,
            quotas=quotas,
            platform_search=platform_search,
        )
        user, _ = await services.auth.register("web@example.com", "correct horse")
        await services.routes.create(
            user.id,
            RouteInput(
                provider="fake", model="fake-model", api_key="sk-test-123456", director=True
            ),
        )
        try:
            yield Bench(services, runner, adapters["fake"], engine, user.id, web)
        finally:
            await services.workbench.aclose()
            await http.aclose()
            await hub.aclose()


def say(words: str = "", *calls: tuple[str, dict[str, Any]]) -> StreamScript:
    return StreamScript(
        pieces=[words] if words else [],
        tool_calls=[
            ToolCall(id=f"c{i}", name=name, arguments=json.dumps(args, ensure_ascii=False))
            for i, (name, args) in enumerate(calls)
        ],
    )


async def run_once(b: Bench, draft_id: str) -> None:
    async with b.engine.connect() as conn:
        run_id = (
            await conn.execute(
                text(
                    """SELECT payload->>'run_id' FROM jobs WHERE kind = 'workbench.run'
                       AND payload->>'draft_id' = :d ORDER BY id DESC LIMIT 1"""
                ),
                {"d": draft_id},
            )
        ).scalar_one()
    await b.runner.run(draft_id, str(run_id))


def tool_results(b: Bench) -> list[str]:
    return [m.content for m in b.adapter.requests[-1].messages if m.role == "tool"]


def recalled(content: str) -> Any:
    """读工具的结果包在 <recall> 里，取出里面的 JSON。"""
    return json.loads(content.removeprefix("<recall>\n").removesuffix("\n</recall>"))


async def test_tool_routes_are_encrypted_defaulted_and_tested(tmp_path: Path) -> None:
    async with bench(tmp_path) as b:
        s = b.services
        with pytest.raises(AppError) as info:
            await s.tool_routes.create(b.user_id, ToolRouteInput(kind="search", provider="tavily"))
        assert info.value.code == "VALIDATION_ERROR"  # 没有 Key
        with pytest.raises(AppError):
            await s.tool_routes.create(
                b.user_id, ToolRouteInput(kind="fetch", provider="brave", api_key="k" * 10)
            )
        first = await s.tool_routes.create(
            b.user_id, ToolRouteInput(kind="search", provider="tavily", api_key="tvly-secret-0001")
        )
        assert first.is_default and first.key_last4 == "0001" and first.status == "unverified"
        second = await s.tool_routes.create(
            b.user_id,
            ToolRouteInput(
                kind="search", provider="bocha", api_key="bocha-secret-0002", default=True
            ),
        )
        routes = {r.id: r for r in await s.tool_routes.list(b.user_id)}
        assert routes[second.id].is_default and not routes[first.id].is_default
        async with b.engine.connect() as conn:
            stored = (
                (await conn.execute(text("SELECT api_key_enc FROM tool_routes"))).scalars().all()
            )
        assert all("secret" not in (s or "") for s in stored)  # 只存密文
        await s.tool_routes.update(b.user_id, first.id, ToolRoutePatch(default=True))
        resolved = await s.tool_routes.resolve_tools(b.user_id)
        assert resolved.search is not None and resolved.search.api_key == "tvly-secret-0001"
        tested = await s.tool_routes.test(b.user_id, first.id)
        assert tested.status == "ok" and tested.probe["ok"] is True
        await s.tool_routes.delete(b.user_id, first.id)
        assert [r.is_default for r in await s.tool_routes.list(b.user_id)] == [True]  # 剩下的顶上

        image = await s.tool_routes.create(
            b.user_id,
            ToolRouteInput(
                kind="image",
                provider="openai_images",
                api_key="img-key-123456",
                model="gpt-image-1",
            ),
        )
        assert (await s.tool_routes.test(b.user_id, image.id)).status == "ok"
        with pytest.raises(AppError) as info:
            await s.tool_routes.create(
                b.user_id,
                ToolRouteInput(
                    kind="image",
                    provider="openai_images",
                    api_key="k" * 10,
                    base_url="https://10.0.0.1/v1",
                    model="m",
                ),
            )
        assert info.value.code == "ENDPOINT_NOT_ALLOWED"


async def test_agent_researches_saves_notes_images_and_generates_covers(tmp_path: Path) -> None:
    async with bench(tmp_path) as b:
        s = b.services
        await s.tool_routes.create(
            b.user_id, ToolRouteInput(kind="search", provider="tavily", api_key="tvly-secret-0001")
        )
        await s.tool_routes.create(
            b.user_id,
            ToolRouteInput(
                kind="image",
                provider="openai_images",
                api_key="img-key-123456",
                model="gpt-image-1",
            ),
        )
        draft = await s.workbench.start(b.user_id, text="做《红楼梦》的林黛玉", language="zh")
        draft_id = draft.summary.id
        page_url = "https://zh.wikipedia.org/wiki/lin"
        b.adapter.streams.extend(
            [
                say("先查资料。", ("web_search", {"query": "林黛玉 性格"})),
                say(
                    "",
                    (
                        "web_fetch",
                        {"urls": [page_url, "https://example.com/?api_key=0123456789abcdef0123"]},
                    ),
                ),
                say(
                    "",
                    (
                        "save_note",
                        {
                            "text": "金陵十二钗之首，寄居荣国府",
                            "url": page_url,
                            "title": "维基百科",
                            "used_in": ["description"],
                        },
                    ),
                    ("image_search", {"query": "林黛玉 画像"}),
                ),
                say(
                    "",
                    (
                        "save_image",
                        {"url": "https://upload.wikimedia.org/lin.png", "license": "public_domain"},
                    ),
                ),
                say(
                    "",
                    (
                        "ask_user",
                        {
                            "questions": [
                                {"question": "用原著哪个时期", "choices": ["初进荣府", "元宵夜"]}
                            ]
                        },
                    ),
                ),
            ]
        )
        await run_once(b, draft_id)
        offered = {t.name for t in b.adapter.requests[0].tools or ()}
        assert {"web_search", "image_search", "web_fetch", "read_page", "save_note"} <= offered
        assert "generate_image" not in offered  # 方案还没写要生成
        fetched = [r for r in b.adapter.requests[2].messages if r.role == "tool"][-1].content
        assert "<recall>" in fetched and "金陵十二钗" in fetched
        assert "looks like it contains a key" in fetched  # 带 Key 的地址拒绝
        view = await s.drafts.get(b.user_id, draft_id)
        assert [n.text for n in view.notes] == ["金陵十二钗之首，寄居荣国府"]
        assert view.notes[0].site == "zh.wikipedia.org"
        searched = [a for a in view.assets if a.source == "search"]
        assert len(searched) == 1 and searched[0].license == "public_domain"
        assert searched[0].source_url == "https://upload.wikimedia.org/lin.png"
        transcript = await s.workbench.transcript(b.user_id, draft_id)
        research = next(m for m in transcript.messages if m.kind == "research")
        assert research.content["searches"] == ["林黛玉 性格", "林黛玉 画像"]
        assert len(research.content["pages"]) == 1

        # 同一个网页 24 小时内再读：用缓存，不再请求
        before = b.web.requests.count("GET zh.wikipedia.org/wiki/lin")
        await s.workbench.post(b.user_id, draft_id, "answers", {"answers": {}})
        plan = {
            "names": ["林黛玉"],
            "pitch": "元宵夜的林黛玉",
            "cover": {"mode": "generate", "count": 2},
            "ip": {"work": "红楼梦", "character": "林黛玉"},
        }
        b.adapter.streams.extend(
            [say("", ("web_fetch", {"urls": [page_url]})), say("", ("propose_plan", plan))]
        )
        await run_once(b, draft_id)
        assert b.web.requests.count("GET zh.wikipedia.org/wiki/lin") == before

        # 确认方案：可以生成 2 张封面，多了不行
        await s.workbench.post(b.user_id, draft_id, "plan_reply", {"approved": True})
        b.adapter.streams.extend(
            [
                say(
                    "",
                    ("write_field", {"field": "name", "text": "林黛玉"}),
                    ("write_field", {"field": "description", "text": "{{char}} 寄居荣国府。"}),
                    ("write_field", {"field": "first_mes", "text": "元宵夜，灯火未歇。"}),
                    ("generate_image", {"prompt": "Lin Daiyu", "style": "水墨", "count": 2}),
                ),
                say("", ("generate_image", {"prompt": "again"})),
                say("写好了。"),
            ]
        )
        await run_once(b, draft_id)
        assert "generate_image" in {t.name for t in b.adapter.requests[-3].tools or ()}
        assert "只允许生成 2 张" in tool_results(b)[-1]
        view = await s.drafts.get(b.user_id, draft_id)
        generated = [a for a in view.assets if a.source == "generated"]
        assert len(generated) == 2 and generated[0].license == "own"
        assert "Chinese ink wash" in (generated[0].prompt or "")

        # 封面面板里直接再出一张（不经过 agent）
        covers = await s.covers.generate(
            b.user_id, draft_id, CoverRequest(prompt="黛玉葬花", count=1)
        )
        assert len(covers) == 1 and covers[0].source == "generated"
        await s.drafts.set_cover(b.user_id, draft_id, covers[0].id, personal_use=False)

        # 保存：资料来源写进作者备注和 meta，作品信息记进 meta.ip
        saved = await s.drafts.save(b.user_id, draft_id)
        detail = await s.cards.get(b.user_id, saved.card.id)
        assert "资料来源：" in detail.card.creator_notes and page_url in detail.card.creator_notes
        assert detail.meta["sources"][0]["used_in"] == ["description"]
        assert saved.card.ip == {"work": "红楼梦", "character": "林黛玉"}
        assert saved.card.cover_blob_id == covers[0].blob_id


async def test_without_a_search_service_the_agent_searches_wikipedia(tmp_path: Path) -> None:
    async with bench(tmp_path) as b:
        s = b.services
        draft = await s.workbench.start(b.user_id, text="做《红楼梦》的林黛玉", language="zh")
        b.adapter.streams.extend(
            [say("先查资料。", ("web_search", {"query": "林黛玉"})), say("好。")]
        )
        await run_once(b, draft.summary.id)
        offered = {t.name for t in b.adapter.requests[0].tools or ()}
        assert {"web_search", "web_fetch"} <= offered
        assert "image_search" not in offered  # 搜图只用自己配的服务
        system = b.adapter.requests[0].messages[0].content
        assert "只能搜维基百科" in system and "没有配置文生图" in system
        assert "外形" in system and "背景经历" in system  # 角色要写全的几项
        result = recalled(tool_results(b)[-1])
        assert result["source"] == "wikipedia"
        assert result["results"][0]["url"].startswith("https://zh.wikipedia.org/zh-cn/")
        assert "GET zh.wikipedia.org/w/api.php" in b.web.requests  # 按草稿的语言选站点
        with pytest.raises(AppError) as info:
            await s.covers.generate(b.user_id, draft.summary.id, CoverRequest(prompt="p"))
        assert info.value.code == "TOOL_ROUTE_MISSING"


PLATFORM_SEARCH = ToolConfig(
    route_id="platform:tavily",
    kind="search",
    provider="tavily",
    label="official",
    api_key="tvly-platform-0001",
)


async def platform_usage(b: Bench) -> int:
    async with b.engine.connect() as conn:
        used = (
            await conn.execute(
                text("SELECT COALESCE(SUM(count), 0) FROM platform_usage WHERE user_id = :u"),
                {"u": b.user_id},
            )
        ).scalar_one()
    return int(used)


async def test_official_search_uses_its_daily_quota_then_wikipedia(tmp_path: Path) -> None:
    quotas = Quotas(platform_searches_per_day=2)
    async with bench(tmp_path, platform_search=PLATFORM_SEARCH, quotas=quotas) as b:
        s = b.services
        draft = await s.workbench.start(b.user_id, text="做《红楼梦》的林黛玉", language="zh")
        b.adapter.streams.extend(
            [
                say("", ("web_search", {"query": "林黛玉 性格"})),
                say("", ("web_search", {"query": "林黛玉 性格"})),  # 同一个查询：用内存里的
                say("", ("web_search", {"query": "林黛玉 外貌"})),
                say("", ("web_search", {"query": "林黛玉 判词"})),  # 今天的 2 次用完了
                say("好。"),
            ]
        )
        await run_once(b, draft.summary.id)
        system = b.adapter.requests[0].messages[0].content
        assert "只能搜维基百科" not in system
        assert [r for r in b.web.requests if "tavily" in r] == ["POST api.tavily.com/search"] * 2
        assert await platform_usage(b) == 2
        results = tool_results(b)
        assert isinstance(recalled(results[0]), list)  # 官方搜索：和自己配的一样
        assert recalled(results[3])["source"] == "wikipedia"


async def test_official_search_out_of_quota_falls_back_and_pauses(tmp_path: Path) -> None:
    async with bench(tmp_path, platform_search=PLATFORM_SEARCH) as b:
        s = b.services
        b.web.tavily_status = 432  # 这个月的免费额度用完了
        draft = await s.workbench.start(b.user_id, text="做《红楼梦》的林黛玉", language="zh")
        b.adapter.streams.extend(
            [
                say("", ("web_search", {"query": "林黛玉 性格"})),
                say("", ("web_search", {"query": "林黛玉 外貌"})),  # 一小时内不再试 Tavily
                say("好。"),
            ]
        )
        await run_once(b, draft.summary.id)
        assert [r for r in b.web.requests if "tavily" in r] == ["POST api.tavily.com/search"]
        assert all(recalled(r)["source"] == "wikipedia" for r in tool_results(b))
