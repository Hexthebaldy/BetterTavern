import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SseParser, type SseMessage } from "./sseParser.ts";

const encoder = new TextEncoder();

function parseChunks(chunks: Uint8Array[]): SseMessage[] {
  const parser = new SseParser();
  const messages: SseMessage[] = [];
  for (const chunk of chunks) messages.push(...parser.feed(chunk));
  messages.push(...parser.end());
  return messages;
}

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

describe("SseParser", () => {
  it("解析 id、event、多行 data 和 retry", () => {
    const messages = parseChunks([
      bytes("event: narrative.delta\nid: t1:1\ndata: a\ndata: b\nretry: 1500\n\n"),
    ]);
    assert.deepEqual(messages, [{ id: "t1:1", event: "narrative.delta", data: "a\nb", retry: 1500 }]);
  });

  it("缺省事件类型是 message，值只去掉一个前导空格", () => {
    assert.deepEqual(parseChunks([bytes("data:  x\n\n")]), [{ event: "message", data: " x" }]);
  });

  it("注释行计数但不派发", () => {
    const parser = new SseParser();
    const messages = parser.feed(bytes(": keepalive\n\n:ping\n\ndata: x\n\n"));
    assert.equal(messages.length, 1);
    assert.equal(parser.comments, 2);
  });

  it("\\r\\n 被拆在两个 chunk 里只算一个行尾", () => {
    const messages = parseChunks([bytes("data: one\r"), bytes("\n\r"), bytes("\ndata: two\r\n\r\n")]);
    assert.deepEqual(
      messages.map((m) => m.data),
      ["one", "two"],
    );
  });

  it("单独的 \\r 也是行尾", () => {
    assert.deepEqual(
      parseChunks([bytes("data: x\r\rdata: y\r\r")]).map((m) => m.data),
      ["x", "y"],
    );
  });

  it("多字节字符被逐字节拆开也能还原（含 4 字节的扩展区汉字和 emoji）", () => {
    const text = "雨夜的酒馆🌧️里，𠮷野家的人又来了。";
    const raw = bytes(`id: s:9\nevent: narrative.delta\ndata: ${JSON.stringify({ text })}\n\n`);
    const chunks = Array.from(raw, (b) => Uint8Array.of(b));
    const [message] = parseChunks(chunks);
    assert.ok(message);
    assert.equal(JSON.parse(message.data).text, text);
    assert.equal(message.id, "s:9");
  });

  it("去掉开头的 BOM", () => {
    assert.deepEqual(parseChunks([Uint8Array.of(0xef, 0xbb, 0xbf), bytes("data: x\n\n")]), [
      { event: "message", data: "x" },
    ]);
  });

  it("结束时丢弃没有空行收尾的事件（可能被截断），也不更新 lastEventId", () => {
    const parser = new SseParser();
    const messages = [
      ...parser.feed(bytes('id: s:1\ndata: {"a":1}\n\nid: s:2\nevent: turn.completed\ndata: {"tu')),
      ...parser.end(),
    ];
    assert.deepEqual(messages, [{ id: "s:1", event: "message", data: '{"a":1}' }]);
    assert.equal(parser.lastEventId, "s:1");
    assert.deepEqual(parseChunks([bytes("data: tail")]), []);
  });

  it("最后一个字符是 \\r 时它算行尾", () => {
    assert.deepEqual(parseChunks([bytes("data: x\r\r")]), [{ event: "message", data: "x" }]);
  });

  it("lastEventId 跨事件保留", () => {
    const parser = new SseParser();
    parser.feed(bytes("id: s:1\ndata: a\n\ndata: b\n\n"));
    assert.equal(parser.lastEventId, "s:1");
  });

  it("任意切分得到同样的事件", () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      event: "narrative.delta",
      data: `第${i}段 ✨ 𠮷`,
    }));
    const raw = bytes(events.map((e) => `event: ${e.event}\r\ndata: ${e.data}\r\n\r\n`).join(""));
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = seed;
      const random = (): number => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < raw.length; ) {
        const size = 1 + Math.floor(random() * 17);
        chunks.push(raw.slice(i, i + size));
        i += size;
      }
      assert.deepEqual(parseChunks(chunks), events);
    }
  });
});
