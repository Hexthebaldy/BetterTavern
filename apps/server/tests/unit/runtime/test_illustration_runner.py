"""故事配图的后台任务（docs/illustrations.md 第 2 节）：先让模型写画面描述，再用出图服务画一张横图。

- 画里的人有封面或头像时带上当参考图；服务不收参考图时去掉再画一次；
- 画风拼在画面描述后面；
- 没有出图服务、写画面描述出错、服务拒绝、空间满了、排队太久，都记成失败和原因；
- 写画面描述的那次调用不管成败都交给 store 记下。

模型用按剧本回复的假适配器，出图服务用假的 HTTP（不连外网）。
"""

from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from PIL import Image

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.illustration import DEADLINE_S
from bettertavern.providers import ErrorClass, ProviderError
from bettertavern.runtime.illustration_runner import IllustrationRunner
from bettertavern.runtime.ports import (
    AgentRunRecord,
    IllustrationDone,
    IllustrationWork,
    ResolvedTools,
    SceneFigure,
    StorageFull,
    ToolConfig,
)
from bettertavern.runtime.prompts import PromptBook
from tests.fakes.runtime import FakeRoutes, ScriptedAdapter, make_route, result, scripted_hub

pytestmark = pytest.mark.anyio


def png(color: tuple[int, int, int] = (40, 90, 160), size: tuple[int, int] = (1536, 1024)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return out.getvalue()


COVER = png((200, 30, 30), (64, 96))


@dataclass
class FakeImageService:
    """假的 OpenAI 兼容出图服务：generations 和 edits（带参考图）两个接口。"""

    edits_status: int = 200
    status: int = 200
    body: str = ""
    requests: list[httpx.Request] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/images/edits") and self.edits_status != 200:
            return httpx.Response(self.edits_status, text="not here")
        if self.status != 200:
            return httpx.Response(self.status, text=self.body)
        if path.endswith(("/images/generations", "/images/edits")):
            data = base64.b64encode(png()).decode()
            return httpx.Response(200, json={"data": [{"b64_json": data}]})
        return httpx.Response(404)

    @property
    def paths(self) -> list[str]:
        return [r.url.path for r in self.requests]


@dataclass
class FakeIllustrationStore:
    work: IllustrationWork | None
    blobs: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    commit_ok: bool = True
    full: bool = False
    committed: list[IllustrationDone] = field(default_factory=list)
    failed: list[tuple[str, str | None, dict[str, Any] | None, AgentRunRecord | None]] = field(
        default_factory=list
    )

    async def load(self, image_id: str) -> IllustrationWork | None:
        return self.work

    async def image_bytes(self, user_id: str, blob_id: str) -> tuple[bytes, str] | None:
        return self.blobs.get(blob_id)

    async def commit(self, work: IllustrationWork, done: IllustrationDone) -> bool:
        if self.full:
            raise StorageFull
        if not self.commit_ok:
            return False
        self.committed.append(done)
        return True

    async def fail(
        self,
        work: IllustrationWork,
        error: str,
        *,
        prompt: str | None = None,
        meta: Any = None,
        run: AgentRunRecord | None = None,
    ) -> None:
        self.failed.append((error, prompt, dict(meta) if meta else None, run))


@dataclass
class FakeTools:
    image: ToolConfig | None = field(
        default_factory=lambda: ToolConfig(
            route_id="tool-1",
            kind="image",
            provider="openai_images",
            label="我的出图",
            api_key="sk-image-0000",
            model="gpt-image-1",
        )
    )

    async def resolve_tools(self, user_id: str) -> ResolvedTools:
        return ResolvedTools(image=self.image)


def work(**changes: Any) -> IllustrationWork:
    base: dict[str, Any] = {
        "image_id": "img-1",
        "user_id": "user-1",
        "playthrough_id": "pt-1",
        "turn_id": "turn-3",
        "language": "zh",
        "age_s": 1.0,
        "request": "",
        "style": "",
        "world": "青石渡\n江南水乡，夜里起雾。",
        "location": "渡口: 青石铺的码头，挂着一盏风灯",
        "action": "把灯递给她",
        "narrative": "沈知微接过油灯，搁在船头，回头看了老船夫一眼。",
        "previous": "雾从河面上漫过来。",
        "figures": (
            SceneFigure("林川", "二十出头的信使，穿灰色短打", blob_id="avatar-1", protagonist=True),
            SceneFigure("沈知微", "十九岁，深蓝长裙，发间一支木簪", blob_id="cover-1"),
            SceneFigure("老船夫", "戴斗笠的老人"),
        ),
    }
    base.update(changes)
    return IllustrationWork(**base)


@dataclass
class Bench:
    runner: IllustrationRunner
    store: FakeIllustrationStore
    adapter: ScriptedAdapter
    service: FakeImageService


def make_bench(
    job: IllustrationWork | None = None, *, tools: FakeTools | None = None, route: bool = True
) -> Bench:
    hub, adapters = scripted_hub("fake")
    service = FakeImageService()
    store = FakeIllustrationStore(
        job or work(), blobs={"cover-1": (COVER, "image/png"), "avatar-1": (COVER, "image/png")}
    )
    runner = IllustrationRunner(
        store=store,
        routes=FakeRoutes({RouteTask.DIRECTOR: make_route()} if route else {}),
        hub=hub,
        prompts=PromptBook(),
        tools=tools or FakeTools(),
        http=httpx.AsyncClient(transport=httpx.MockTransport(service.handler)),
    )
    return Bench(runner, store, adapters["fake"], service)


def scene(prompt: str, people: list[str]) -> str:
    return json.dumps({"prompt": prompt, "people": people}, ensure_ascii=False)


async def test_draws_with_references_and_style() -> None:
    b = make_bench(work(style="anime", request="沈知微的特写"))
    b.adapter.completions.append(
        result(scene("A young woman in a dark blue dress sets a lamp on a ferry.", ["沈知微"]))
    )

    assert await b.runner.process("img-1") is True

    # 模型看到了这一回合的正文、玩家想看的、画里可能有的人
    sent = b.adapter.requests[0].messages[-1].content
    assert "沈知微接过油灯" in sent and "沈知微的特写" in sent and "深蓝长裙" in sent
    # 带着沈知微的封面去画（走带参考图的接口）
    assert b.service.paths == ["/v1/images/edits"]
    [done] = b.store.committed
    assert done.prompt.endswith("Style: anime illustration.")
    assert done.meta["references"] == ["沈知微"] and done.meta["aspect"] == "landscape"
    # 存成 WebP，长边缩到 1536 以内
    assert done.image.mime == "image/webp" and max(done.image.width, done.image.height) <= 1536
    assert done.run is not None and done.run.status == "ok" and done.run.agent == "illustrator"
    assert b.store.failed == []


async def test_service_without_reference_support_draws_again_without_them() -> None:
    b = make_bench()
    b.service.edits_status = 404
    b.adapter.completions.append(result(scene("A misty ferry at night.", ["沈知微", "林川"])))

    assert await b.runner.process("img-1") is True
    assert b.service.paths == ["/v1/images/edits", "/v1/images/generations"]
    [done] = b.store.committed
    assert done.meta["references"] == []
    assert "Style:" not in done.prompt  # 没选画风


async def test_names_not_on_the_list_bring_no_reference() -> None:
    b = make_bench()
    b.adapter.completions.append(result(scene("Two strangers on a pier.", ["路人甲", "老船夫"])))

    assert await b.runner.process("img-1") is True
    # 老船夫没有封面，路人甲不在名单上：直接画
    assert b.service.paths == ["/v1/images/generations"]
    assert b.store.committed[0].meta["people"] == ["老船夫"]


async def test_plain_text_reply_is_used_as_the_description() -> None:
    b = make_bench()
    b.adapter.completions.append(result("A lantern glowing in thick fog over a river."))

    assert await b.runner.process("img-1") is True
    assert b.store.committed[0].prompt == "A lantern glowing in thick fog over a river."
    assert b.service.paths == ["/v1/images/generations"]


async def test_no_image_service_keeps_the_description_and_the_run() -> None:
    b = make_bench(tools=FakeTools(image=None))
    b.adapter.completions.append(result(scene("A ferry.", [])))

    assert await b.runner.process("img-1") is False
    [(error, prompt, _, run)] = b.store.failed
    assert error == "tool_missing" and prompt == "A ferry."
    assert run is not None and run.status == "ok"  # 写画面描述那次照样记下
    assert b.service.requests == []


async def test_model_error_is_recorded() -> None:
    b = make_bench()
    b.adapter.completions.append(ProviderError(ErrorClass.RATE_LIMIT, "slow down", status=429))

    assert await b.runner.process("img-1") is False
    [(error, prompt, _, run)] = b.store.failed
    assert error == "model_failed" and prompt is None
    assert run is not None and run.status == "failed" and run.error_class == "rate_limit"


async def test_empty_reply_is_a_model_failure() -> None:
    b = make_bench()
    b.adapter.completions.append(result('{"prompt": "", "people": []}'))

    assert await b.runner.process("img-1") is False
    assert b.store.failed[0][0] == "model_failed"


async def test_no_model_at_all() -> None:
    b = make_bench(route=False)

    assert await b.runner.process("img-1") is False
    assert b.store.failed == [("route_missing", None, None, None)]
    assert b.adapter.requests == []


async def test_refused_prompt_is_not_retried() -> None:
    b = make_bench()
    b.service.status = 400
    b.service.body = '{"error": {"code": "safety_violation"}}'
    b.adapter.completions.append(result(scene("A ferry.", ["沈知微"])))

    assert await b.runner.process("img-1") is False
    assert b.service.paths == ["/v1/images/edits"]  # 被拒绝不去掉参考图再试
    [(error, prompt, meta, _)] = b.store.failed
    assert error == "blocked" and prompt == "A ferry."
    assert meta is not None and meta["protocol"] == "openai_images"


async def test_bad_key_is_reported() -> None:
    b = make_bench()
    b.service.status = 401
    b.adapter.completions.append(result(scene("A ferry.", [])))

    assert await b.runner.process("img-1") is False
    assert b.store.failed[0][0] == "auth"


async def test_storage_full_is_reported() -> None:
    b = make_bench()
    b.store.full = True
    b.adapter.completions.append(result(scene("A ferry.", [])))

    assert await b.runner.process("img-1") is False
    assert b.store.failed[0][0] == "storage_full"


async def test_waited_too_long_in_the_queue() -> None:
    b = make_bench(work(age_s=DEADLINE_S + 5))

    assert await b.runner.process("img-1") is False
    assert b.store.failed == [("timeout", None, None, None)]
    assert b.adapter.requests == [] and b.service.requests == []


async def test_deleted_meanwhile_is_dropped_quietly() -> None:
    b = make_bench()
    b.store.commit_ok = False
    b.adapter.completions.append(result(scene("A ferry.", [])))

    assert await b.runner.process("img-1") is False
    assert b.store.failed == []


async def test_nothing_to_do() -> None:
    b = make_bench()
    b.store.work = None

    assert await b.runner.process("img-1") is False
    assert b.adapter.requests == []
