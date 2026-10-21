import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPIES } from "../src/i18n/all.ts";
import { notFoundHtml, robotsTxt, sitemapXml } from "./seo.ts";

describe("robotsTxt", () => {
  it("页面都能抓，安装包目录不让抓；给了站点地址才写站点地图", () => {
    const plain = robotsTxt();
    assert.match(plain, /^User-agent: \*$/m);
    assert.match(plain, /^Disallow: \/downloads\/$/m);
    assert.doesNotMatch(plain, /Sitemap/);
    assert.match(robotsTxt("https://example.com/BT"), /^Sitemap: https:\/\/example\.com\/BT\/sitemap\.xml$/m);
  });
});

describe("sitemapXml", () => {
  it("三种语言的首页各一条，每条列出全部语言版本和 x-default", () => {
    const xml = sitemapXml("https://example.com/");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, ["https://example.com/", "https://example.com/en/", "https://example.com/ja/"]);
    assert.equal(xml.match(/hreflang="ja" href="https:\/\/example\.com\/ja\/"/g)?.length, 3);
    assert.equal(xml.match(/hreflang="x-default" href="https:\/\/example\.com\/"/g)?.length, 3);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });
});

describe("notFoundHtml", () => {
  it("三种语言的说明都在，各自链回自己的首页，不让收录", () => {
    const html = notFoundHtml(COPIES, {
      siteUrl: "https://example.com",
      iconHref: "https://example.com/assets/i.svg",
    });
    assert.match(html, /<meta name="robots" content="noindex" \/>/);
    for (const copy of Object.values(COPIES)) assert.ok(html.includes(copy.notFound.title));
    assert.match(html, /<section lang="en">[\s\S]*href="https:\/\/example\.com\/en\/"/);
    assert.match(html, /<link rel="icon" href="https:\/\/example\.com\/assets\/i\.svg"/);
  });

  it("没给站点地址时从根目录算", () => {
    assert.match(notFoundHtml(COPIES), /<section lang="ja">[\s\S]*href="\/ja\/"/);
  });
});
