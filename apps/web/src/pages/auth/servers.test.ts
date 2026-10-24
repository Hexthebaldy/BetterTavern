import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  displaySite,
  MAX_RECENT_SITES,
  OFFICIAL_SITE,
  offersServerSwitch,
  parseRecentSites,
  rememberSite,
  siteChoices,
  siteOrigin,
} from "./servers.ts";

const now = new Date("2026-10-24T08:00:00Z");

describe("siteOrigin", () => {
  it("没写协议时补 http://，去掉路径和末尾斜杠", () => {
    assert.equal(siteOrigin(" 192.168.1.10:8080 "), "http://192.168.1.10:8080");
    assert.equal(siteOrigin("tavern.example.com/login/"), "http://tavern.example.com");
    assert.equal(siteOrigin("https://tavern.example.com/"), "https://tavern.example.com");
    assert.equal(siteOrigin("HTTP://LOCALHOST:8080"), "http://localhost:8080");
  });

  it("默认端口不写出来", () => {
    assert.equal(siteOrigin("https://tavern.example.com:443"), "https://tavern.example.com");
  });

  it("不认 http、https 以外的协议，也不认带账号密码的地址", () => {
    assert.equal(siteOrigin("javascript:alert(1)"), null);
    assert.equal(siteOrigin("ftp://example.com"), null);
    assert.equal(siteOrigin("file:///etc/passwd"), null);
    assert.equal(siteOrigin("http://user:pass@example.com"), null);
    assert.equal(siteOrigin("https://bettertavern.com@evil.example"), null);
  });

  it("空的、解析不了的返回 null", () => {
    assert.equal(siteOrigin("   "), null);
    assert.equal(siteOrigin("http://"), null);
    assert.equal(siteOrigin("not a url"), null);
  });
});

describe("offersServerSwitch", () => {
  it("官方网站上不放，自己部署的网页上放", () => {
    assert.equal(offersServerSwitch(OFFICIAL_SITE), false);
    assert.equal(offersServerSwitch("http://192.168.1.10:8080"), true);
    assert.equal(offersServerSwitch("http://localhost:5173"), true);
  });
});

describe("displaySite", () => {
  it("去掉 http://，https 留着", () => {
    assert.equal(displaySite("http://192.168.1.10:8080"), "192.168.1.10:8080");
    assert.equal(displaySite(OFFICIAL_SITE), "https://bettertavern.com");
  });
});

describe("rememberSite", () => {
  it("移到最前面，不重复", () => {
    const list = [
      { url: "http://a:8080", openedAt: "2026-10-01T00:00:00.000Z" },
      { url: "http://b:8080", openedAt: "2026-10-02T00:00:00.000Z" },
    ];
    assert.deepEqual(rememberSite(list, "http://b:8080", now), [
      { url: "http://b:8080", openedAt: now.toISOString() },
      { url: "http://a:8080", openedAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it(`最多留 ${MAX_RECENT_SITES} 个`, () => {
    let list: ReturnType<typeof rememberSite> = [];
    for (let i = 0; i < 8; i++) list = rememberSite(list, `http://s${i}:8080`, now);
    assert.equal(list.length, MAX_RECENT_SITES);
    assert.equal(list[0]?.url, "http://s7:8080");
  });
});

describe("siteChoices", () => {
  const list = [
    { url: "http://192.168.1.10:8080", openedAt: "" },
    { url: OFFICIAL_SITE, openedAt: "" },
    { url: "http://localhost:8080", openedAt: "" },
  ];

  it("不在官方时官方排第一个，正在用的不列", () => {
    assert.deepEqual(siteChoices(list, "http://localhost:8080"), [OFFICIAL_SITE, "http://192.168.1.10:8080"]);
  });

  it("在官方时不列官方", () => {
    assert.deepEqual(siteChoices(list, OFFICIAL_SITE), ["http://192.168.1.10:8080", "http://localhost:8080"]);
  });
});

describe("parseRecentSites", () => {
  it("只留格式对的项", () => {
    assert.deepEqual(
      parseRecentSites([
        { url: "http://a:8080", openedAt: "x", extra: 1 },
        { url: "javascript:alert(1)", openedAt: "x" },
        { url: "http://b:8080/path", openedAt: "x" },
        { url: 3, openedAt: "x" },
        null,
        "http://c:8080",
      ]),
      [{ url: "http://a:8080", openedAt: "x" }],
    );
  });

  it("不是数组时是空的", () => {
    assert.deepEqual(parseRecentSites({ url: "http://a:8080" }), []);
    assert.deepEqual(parseRecentSites(null), []);
  });
});
