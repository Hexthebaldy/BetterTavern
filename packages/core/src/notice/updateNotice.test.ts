import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadUpdateNotice, noticeView, parseUpdateNotice, type NoticeFetch } from "./updateNotice.ts";

const AT = "2026-11-06T22:00:00Z";
const at = Date.parse(AT);
const MINUTE = 60_000;

describe("parseUpdateNotice", () => {
  it("认出更新提示", () => {
    assert.deepEqual(parseUpdateNotice({ kind: "update", at: AT }), { at });
  });

  it("其他内容都当作没有提示", () => {
    for (const data of [
      null,
      "update",
      {},
      { kind: "update" },
      { kind: "update", at: "not a time" },
      { kind: "update", at: 1 },
      { kind: "other", at: AT },
    ]) {
      assert.equal(parseUpdateNotice(data), null);
    }
  });
});

describe("noticeView", () => {
  const notice = { at };

  it("没有提示时不显示", () => {
    assert.equal(noticeView(null, at), null);
  });

  it("更新前是即将更新，到点以后是正在更新", () => {
    assert.equal(noticeView(notice, at - 10 * MINUTE)?.phase, "upcoming");
    assert.equal(noticeView(notice, at - 1)?.phase, "upcoming");
    assert.equal(noticeView(notice, at)?.phase, "updating");
    assert.equal(noticeView(notice, at + 5 * MINUTE)?.phase, "updating");
  });

  it("文件没撤掉时，过一段时间不再显示", () => {
    assert.equal(noticeView(notice, at + 15 * MINUTE)?.phase, "updating");
    assert.equal(noticeView(notice, at + 15 * MINUTE + 1), null);
  });

  it("时间按用户所在的时区显示成时分", () => {
    const local = new Date(2026, 10, 6, 6, 5).getTime();
    assert.equal(noticeView({ at: local }, local)?.time, "06:05");
  });
});

describe("loadUpdateNotice", () => {
  const answer =
    (status: number, body: string): NoticeFetch =>
    async () => ({ status, text: async () => body });

  it("读到提示", async () => {
    const urls: string[] = [];
    const fetcher: NoticeFetch = async (url) => {
      urls.push(url);
      return { status: 200, text: async () => JSON.stringify({ kind: "update", at: AT }) };
    };
    assert.deepEqual(await loadUpdateNotice("https://example.test", fetcher), { at });
    assert.deepEqual(urls, ["https://example.test/notice.json"]);
  });

  it("没有文件、返回网页、连不上，都当作没有提示", async () => {
    assert.equal(await loadUpdateNotice("", answer(204, "")), null);
    assert.equal(await loadUpdateNotice("", answer(404, "")), null);
    assert.equal(await loadUpdateNotice("", answer(200, "<!doctype html>")), null);
    const broken: NoticeFetch = async () => {
      throw new TypeError("Network request failed");
    };
    assert.equal(await loadUpdateNotice("", broken), null);
  });
});
