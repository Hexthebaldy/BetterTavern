import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  displayServer,
  markServerFailed,
  MAX_RECENT_SERVERS,
  parseRecentServers,
  rememberServer,
  serverChoices,
  type RecentServer,
} from "./servers.ts";

const T1 = new Date("2026-10-01T00:00:00Z");
const T2 = new Date("2026-10-02T00:00:00Z");

describe("最近用过的服务器", () => {
  it("用过的移到最前面，并清掉失败记录", () => {
    let list: RecentServer[] = [];
    list = rememberServer(list, "http://a:8000", T1);
    list = rememberServer(list, "http://b:8000", T1);
    list = markServerFailed(list, "http://a:8000", T2);
    assert.equal(list[1]?.failedAt, T2.toISOString());
    list = rememberServer(list, "http://a:8000", T2);
    assert.deepEqual(
      list.map((s) => [s.url, s.failedAt]),
      [
        ["http://a:8000", null],
        ["http://b:8000", null],
      ],
    );
  });

  it("最多留 5 个", () => {
    let list: RecentServer[] = [];
    for (let i = 0; i < 8; i += 1) list = rememberServer(list, `http://h${i}`, T1);
    assert.equal(list.length, MAX_RECENT_SERVERS);
    assert.equal(list[0]?.url, "http://h7");
  });

  it("连不上的地址不在列表里时也记下来", () => {
    const list = markServerFailed([], "http://x", T1);
    assert.equal(list[0]?.url, "http://x");
    assert.equal(list[0]?.failedAt, T1.toISOString());
  });

  it("面板里一定有当前地址", () => {
    const list = rememberServer([], "http://a", T1);
    assert.deepEqual(
      serverChoices(list, "http://c").map((s) => s.url),
      ["http://c", "http://a"],
    );
    assert.equal(serverChoices(list, "http://a").length, 1);
    // 还没设置服务器（没有默认地址）时不列空的一项
    assert.deepEqual(serverChoices(list, ""), list);
  });

  it("显示时去掉 http://，保留 https://", () => {
    assert.equal(displayServer("http://192.168.1.10:8000/"), "192.168.1.10:8000");
    assert.equal(displayServer("https://tavern.example.com"), "https://tavern.example.com");
  });

  it("丢掉格式不对的存储内容", () => {
    assert.deepEqual(parseRecentServers("x"), []);
    assert.deepEqual(parseRecentServers([{ url: 1 }, { url: "http://a", lastUsedAt: "t", failedAt: 3 }]), [
      { url: "http://a", lastUsedAt: "t", failedAt: null },
    ]);
  });
});
