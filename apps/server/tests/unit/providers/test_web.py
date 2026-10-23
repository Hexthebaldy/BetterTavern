"""联网的服务商层：地址检查、长网页的截取、本地读网页，
以及每家服务商的请求和返回（用假的 HTTP，不连外网）。"""

from __future__ import annotations

import io
import ipaddress
import json
from collections.abc import Callable

import httpx
import pytest
from PIL import Image

from bettertavern.providers.transport import EndpointPolicy, check_url, resolve_and_check
from bettertavern.providers.web import (
    WEB_PROVIDERS,
    WIKIPEDIA,
    WebConfig,
    WebError,
    clip_page,
    download_image,
    fetch_page,
    read_lines,
    secret_in_url,
    strip_inline_images,
)
from bettertavern.providers.web.pagetext import looks_binary

pytestmark = pytest.mark.anyio


def client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)


@pytest.mark.parametrize(
    ("url", "secret"),
    [
        ("https://example.com/a?q=林黛玉", False),
        ("https://example.com/a?api_key=0123456789abcdef0123", True),
        ("https://example.com/a?token=short", False),
        ("https://example.com/sk-abcdefghijklmnopqrstuvwxyz/x", True),
        ("https://example.com/?key=AIzaSyA1234567890abcdefghijklmnopqrs", True),
    ],
)
def test_secret_in_url(url: str, secret: bool) -> None:
    assert secret_in_url(url) is secret


def test_long_pages_keep_head_and_tail() -> None:
    content = "\n".join(f"第{i}行" + "字" * 20 for i in range(1, 401))
    clipped = clip_page(
        content, 2000, page_id="p1", more_hint="省略 {start}-{end}/{total} 用 {page_id}"
    )
    assert clipped.startswith("第1行") and clipped.rstrip().endswith("字" * 20)
    assert "第400行" in clipped and "省略" in clipped and "/400 用 p1" in clipped
    assert len(clipped) < 2200
    middle, total = read_lines(content, 200, 2)
    assert total == 400 and middle.startswith("第200行") and "第201行" in middle
    assert clip_page("短", 100, page_id="p", more_hint="") == "短"


def test_inline_images_and_binary() -> None:
    text = "前![猫](data:image/png;base64," + "A" * 100 + ")后 data:image/jpeg;base64," + "B" * 80
    assert strip_inline_images(text) == "前[IMAGE: 猫]后 [IMAGE]"
    assert looks_binary(b"\x89PNG\r\n\x1a\n\x00\x00")
    assert not looks_binary("纯文字".encode())


async def test_fake_ip_ranges_pass_without_opening_private() -> None:
    policy = EndpointPolicy(fake_ip_ranges=("198.18.0.0/15",))

    async def resolver(host: str, port: int) -> list[ipaddress.IPv4Address]:
        return [ipaddress.IPv4Address("198.18.0.9")]

    assert await resolve_and_check("example.com", 443, policy, resolver)
    with pytest.raises(Exception, match="private or reserved"):
        await resolve_and_check("example.com", 443, EndpointPolicy(), resolver)
    # 假 IP 段以外的内网地址照样拒绝
    with pytest.raises(Exception, match="Private or reserved"):
        check_url("https://10.0.0.1/", policy)


HTML = (
    """<html><head><title>林黛玉 - 百科</title></head><body>
<nav>导航 首页 登录</nav>
<article><h1>林黛玉</h1><p>林黛玉是《红楼梦》的女主角之一，金陵十二钗之首。</p>
<p>她自幼体弱，寄居荣国府，与贾宝玉青梅竹马。</p><p>"""
    + "她工诗词。" * 40
    + """</p></article>
<footer>版权所有</footer></body></html>"""
)


async def test_local_fetch_follows_redirects_and_extracts_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/wiki"})
        if request.url.path == "/wiki":
            return httpx.Response(
                200, text=HTML, headers={"content-type": "text/html; charset=utf-8"}
            )
        if request.url.path == "/pdf":
            return httpx.Response(
                200, content=b"%PDF-1.4", headers={"content-type": "application/pdf"}
            )
        if request.url.path == "/spa":
            return httpx.Response(
                200,
                text="<html><body><div id=app></div></body></html>",
                headers={"content-type": "text/html"},
            )
        return httpx.Response(404)

    async with client(handler) as http:
        page = await fetch_page(http, "https://example.org/old")
        assert page.final_url == "https://example.org/wiki"
        assert page.title.startswith("林黛玉")
        assert "金陵十二钗" in page.content and "导航" not in page.content
        assert page.fetcher == "local"
        with pytest.raises(WebError) as info:
            await fetch_page(http, "https://example.org/pdf")
        assert info.value.kind == "binary"
        with pytest.raises(WebError) as info:
            await fetch_page(http, "https://example.org/spa")
        assert info.value.kind == "empty"
        with pytest.raises(WebError) as info:
            await fetch_page(http, "https://example.org/missing")
        assert info.value.kind == "http"


async def test_download_image_checks_type() -> None:
    out = io.BytesIO()
    Image.new("RGB", (4, 4)).save(out, format="PNG")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/a.png":
            return httpx.Response(
                200, content=out.getvalue(), headers={"content-type": "image/png"}
            )
        return httpx.Response(200, text="<html>", headers={"content-type": "text/html"})

    async with client(handler) as http:
        assert (await download_image(http, "https://img.example/a.png")).startswith(b"\x89PNG")
        with pytest.raises(WebError):
            await download_image(http, "https://img.example/page")


async def test_tavily_search_images_and_extract() -> None:
    seen: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append({"path": request.url.path, "auth": request.headers["authorization"], **body})
        if request.url.path == "/search":
            return httpx.Response(
                200,
                json={
                    "results": [
                        {"title": "林黛玉", "url": "https://a.example/1", "content": "金陵十二钗"}
                    ],
                    "images": [
                        {"url": "https://img.example/1.jpg", "description": "画像"},
                        "https://img.example/2.jpg",
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "results": [{"url": "https://a.example/1", "raw_content": "正文"}],
                "failed_results": [],
            },
        )

    tavily = WEB_PROVIDERS["tavily"]
    config = WebConfig(api_key="tvly-test")
    async with client(handler) as http:
        hits = await tavily.search(http, config, "林黛玉", 5)
        assert hits[0].url == "https://a.example/1" and hits[0].snippet == "金陵十二钗"
        images = await tavily.images(http, config, "林黛玉 画像", 5)
        assert [i.image_url for i in images] == [
            "https://img.example/1.jpg",
            "https://img.example/2.jpg",
        ]
        pages = await tavily.fetch(http, config, ["https://a.example/1", "https://a.example/2"])
    assert seen[0]["auth"] == "Bearer tvly-test" and seen[0]["max_results"] == 5
    assert seen[1]["include_images"] is True
    assert not isinstance(pages[0], WebError) and pages[0].content == "正文"
    assert isinstance(pages[1], WebError)


async def test_brave_searxng_bocha_and_jina() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == "api.search.brave.com":
            assert request.headers["x-subscription-token"] == "brave-key"
            if path.endswith("/web/search"):
                return httpx.Response(
                    200,
                    json={
                        "web": {
                            "results": [{"title": "t", "url": "https://b/1", "description": "d"}]
                        }
                    },
                )
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "title": "i",
                            "url": "https://b/page",
                            "properties": {"url": "https://b/i.jpg", "width": 600, "height": 900},
                            "thumbnail": {"src": "https://b/t.jpg"},
                        }
                    ]
                },
            )
        if host == "searx.local":
            assert request.url.params["format"] == "json"
            if request.url.params["categories"] == "images":
                return httpx.Response(
                    200,
                    json={
                        "results": [
                            {
                                "img_src": "https://s/i.png",
                                "url": "https://s/p",
                                "resolution": "640x480",
                            }
                        ]
                    },
                )
            return httpx.Response(
                200, json={"results": [{"title": "s", "url": "https://s/1", "content": "c"}]}
            )
        if host == "api.bochaai.com":
            assert request.headers["authorization"] == "Bearer bocha-key"
            return httpx.Response(
                200,
                json={
                    "code": 200,
                    "data": {
                        "webPages": {
                            "value": [{"name": "博查", "url": "https://c/1", "summary": "摘要"}]
                        },
                        "images": {
                            "value": [
                                {
                                    "contentUrl": "https://c/i.jpg",
                                    "hostPageUrl": "https://c/p",
                                    "width": 300,
                                    "height": 400,
                                }
                            ]
                        },
                    },
                },
            )
        if host == "r.jina.ai":
            assert json.loads(request.content)["url"] == "https://d/1"
            return httpx.Response(
                200, json={"data": {"title": "J", "url": "https://d/1", "content": "# 标题\n正文"}}
            )
        return httpx.Response(404)

    async with client(handler) as http:
        brave = WEB_PROVIDERS["brave"]
        config = WebConfig(api_key="brave-key")
        assert (await brave.search(http, config, "q", 3))[0].snippet == "d"
        image = (await brave.images(http, config, "q", 3))[0]
        assert (image.image_url, image.width, image.height) == ("https://b/i.jpg", 600, 900)

        searx = WEB_PROVIDERS["searxng"]
        with pytest.raises(WebError):
            await searx.search(http, WebConfig(), "q", 3)
        sconfig = WebConfig(base_url="http://searx.local")
        assert (await searx.search(http, sconfig, "q", 3))[0].url == "https://s/1"
        simage = (await searx.images(http, sconfig, "q", 3))[0]
        assert (simage.width, simage.height) == (640, 480)

        bocha = WEB_PROVIDERS["bocha"]
        bconfig = WebConfig(api_key="bocha-key")
        assert (await bocha.search(http, bconfig, "q", 3))[0].snippet == "摘要"
        assert (await bocha.images(http, bconfig, "q", 3))[0].page_url == "https://c/p"

        jina = WEB_PROVIDERS["jina"]
        page = (await jina.fetch(http, WebConfig(), ["https://d/1"]))[0]
        assert not isinstance(page, WebError) and page.title == "J" and "正文" in page.content


async def test_vendor_errors_become_web_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad key"})

    async with client(handler) as http:
        with pytest.raises(WebError) as info:
            await WEB_PROVIDERS["tavily"].search(http, WebConfig(api_key="x"), "q", 3)
    assert info.value.kind == "auth" and "x" not in info.value.message.split()


async def test_wikipedia_search_needs_no_key_and_falls_back_to_english() -> None:
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.host, request.url.params["srsearch"]))
        assert request.url.path == "/w/api.php"
        assert "BetterTavern" in request.headers["user-agent"]  # 维基媒体要求带上能找到项目的 UA
        assert "authorization" not in request.headers
        if request.url.host == "zh.wikipedia.org" and request.url.params["srsearch"] == "林黛玉":
            item = {
                "title": "林黛玉",
                "snippet": '<span class="searchmatch">林黛玉</span>，金陵十二钗之首&amp;',
            }
            return httpx.Response(200, json={"query": {"search": [item]}})
        if request.url.host == "en.wikipedia.org":
            return httpx.Response(
                200, json={"query": {"search": [{"title": "Frieren (character)"}]}}
            )
        return httpx.Response(200, json={"query": {"search": []}})

    async with client(handler) as http:
        hits = await WIKIPEDIA.search(http, WebConfig(params={"lang": "zh"}), "林黛玉", 5)
        assert [(h.title, h.snippet) for h in hits] == [("林黛玉", "林黛玉，金陵十二钗之首&")]
        assert hits[0].url == "https://zh.wikipedia.org/zh-cn/%E6%9E%97%E9%BB%9B%E7%8E%89"  # 简体
        # 中文站一条也没有：再搜英文站
        hits = await WIKIPEDIA.search(http, WebConfig(params={"lang": "zh"}), "Frieren", 5)
        assert [h.url for h in hits] == ["https://en.wikipedia.org/wiki/Frieren_%28character%29"]
    assert seen[-2:] == [("zh.wikipedia.org", "Frieren"), ("en.wikipedia.org", "Frieren")]
    assert "wikipedia" not in WEB_PROVIDERS  # 内置的兜底，用户不能把它配成自己的服务


async def test_tavily_out_of_quota_is_a_quota_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(432, json={"detail": {"error": "This request exceeds your plan"}})

    async with client(handler) as http:
        with pytest.raises(WebError) as info:
            await WEB_PROVIDERS["tavily"].search(http, WebConfig(api_key="x"), "q", 3)
    assert info.value.kind == "quota"
