import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advance,
  begin,
  choose,
  clampName,
  DEFAULT_NAME,
  finish,
  fullText,
  initialState,
  isEnded,
  NAME_MAX,
  rename,
  restart,
  seenWorld,
  segments,
  send,
  skip,
  startWriting,
  STORY,
  tick,
  worldEntries,
  type DemoState,
} from "./story.ts";

/** 一直 tick 到写完 */
function writeOut(s: DemoState): DemoState {
  let cur = startWriting(s);
  for (let i = 0; i < 1000 && cur.phase === "writing"; i++) cur = tick(cur);
  return cur;
}

/** 点第 i 个选项并进入下一段，逐字写完 */
function pickAndRead(s: DemoState, i: number): DemoState {
  return writeOut(advance(choose(s, i), false));
}

describe("开场", () => {
  it("一开始第一段已经写完，两个选项在下面，世界里有开场的五个条目", () => {
    const s = initialState();
    assert.equal(s.node, "root");
    assert.equal(s.phase, "idle");
    assert.equal(s.shown, fullText("root", DEFAULT_NAME).length);
    assert.deepEqual(segments(s), [{ text: fullText("root", DEFAULT_NAME), act: null, caret: false }]);
    assert.equal(STORY[s.node].options?.length, 2);
    assert.deepEqual(s.found, ["me", "pier", "tower", "keeper", "bell"]);
    assert.deepEqual(s.fresh, s.found);
  });

  it("一开始不让读屏把第一段再念一遍", () => {
    assert.equal(initialState().live, "");
  });
});

describe("推进", () => {
  it("点了选项先标出选中的，进入下一段后先构思、再逐字出现", () => {
    const chosen = choose(initialState(), 0);
    assert.equal(chosen.chosen, 0);
    assert.equal(chosen.node, "root");

    const next = advance(chosen, false);
    assert.equal(next.node, "a");
    assert.equal(next.phase, "thinking");
    assert.equal(segments(next).at(-1)?.text, "");
    assert.equal(segments(next).at(-1)?.caret, true);

    const writing = tick(startWriting(next));
    assert.equal(writing.phase, "writing");
    assert.equal(segments(writing).at(-1)?.text, fullText("a", DEFAULT_NAME).slice(0, 2));
  });

  it("前一段带着当时选的行动留在上面", () => {
    const s = pickAndRead(initialState(), 1);
    const segs = segments(s);
    assert.equal(segs.length, 2);
    assert.equal(segs[0]?.act, "回头去找那口钟");
    assert.equal(segs[1]?.text, fullText("b", DEFAULT_NAME));
  });

  it("写到头就算写完：出现选项，世界里加上这一段的条目", () => {
    const s = pickAndRead(initialState(), 0);
    assert.equal(s.phase, "idle");
    assert.equal(s.live, fullText("a", DEFAULT_NAME));
    assert.deepEqual(s.found.slice(-2), ["grey", "log"]);
  });

  it("两轮以后结束", () => {
    let s = initialState();
    assert.equal(isEnded(s), false);
    s = pickAndRead(s, 0);
    assert.equal(isEnded(s), false);
    s = pickAndRead(s, 1);
    assert.equal(s.node, "ab");
    assert.equal(isEnded(s), true);
    assert.equal(segments(s).length, 3);
  });

  it("四条路都能走到结尾", () => {
    for (const [first, second, end] of [
      [0, 0, "aa"],
      [0, 1, "ab"],
      [1, 0, "ba"],
      [1, 1, "bb"],
    ] as const) {
      const s = pickAndRead(pickAndRead(initialState(), first), second);
      assert.equal(s.node, end);
      assert.equal(isEnded(s), true);
    }
  });

  it("还在写、已经点过、或者没有这个选项时，点选项不起作用", () => {
    const writing = startWriting(advance(choose(initialState(), 0), false));
    assert.equal(choose(writing, 0), writing);

    const chosen = choose(initialState(), 0);
    assert.equal(choose(chosen, 1), chosen);

    const s = initialState();
    assert.equal(choose(s, 2), s);
  });

  it("全部显示：跳过逐字，直接写完", () => {
    const s = skip(startWriting(advance(choose(initialState(), 1), false)));
    assert.equal(s.phase, "idle");
    assert.equal(segments(s).at(-1)?.text, fullText("b", DEFAULT_NAME));
  });

  it("减少动态效果时，下一段直接显示全文", () => {
    const s = advance(choose(initialState(), 0), true);
    assert.equal(s.phase, "idle");
    assert.equal(segments(s).at(-1)?.text, fullText("a", DEFAULT_NAME));
  });

  it("从头再读：保留名字，回到开场，世界清空后重新出现", () => {
    let s = rename(pickAndRead(initialState(), 0), "阿远");
    s = send(s, "我转身离开");
    const again = restart(s, false);
    assert.equal(again.node, "root");
    assert.equal(again.phase, "thinking");
    assert.equal(again.name, "阿远");
    assert.deepEqual(again.steps, []);
    assert.deepEqual(again.found, []);
    assert.equal(again.typed, "");
    assert.deepEqual(writeOut(again).found, ["me", "pier", "tower", "keeper", "bell"]);
  });
});

describe("主角的名字", () => {
  it("改了名字，前文和当前这一段里的名字都跟着换", () => {
    let s = pickAndRead(initialState(), 0);
    s = pickAndRead(s, 1);
    s = rename(s, "阿远");
    const text = segments(s)
      .map((x) => x.text)
      .join("");
    assert.match(text, /“阿远？”她说/);
    assert.match(text, /告诉阿远——别信那口钟/);
    assert.doesNotMatch(text, new RegExp(DEFAULT_NAME));
  });

  it("写完的这一段换了名字也显示全文", () => {
    const s = rename(pickAndRead(initialState(), 0), "司徒长风");
    assert.equal(segments(s).at(-1)?.text, fullText("a", "司徒长风"));
  });

  it("世界里“我”的名字也跟着换", () => {
    const s = rename(initialState(), "阿远");
    assert.equal(worldEntries(s).find((e) => e.me)?.name, "阿远");
  });

  it("去掉首尾空白；空的不改", () => {
    assert.equal(rename(initialState(), "  阿远 ").name, "阿远");
    assert.equal(rename(initialState(), "   ").name, DEFAULT_NAME);
  });

  it(`最多 ${NAME_MAX} 个字`, () => {
    assert.equal(clampName("一二三四五六七八九十"), "一二三四五六七八");
    assert.equal(rename(initialState(), "一二三四五六七八九十").name, "一二三四五六七八");
  });
});

describe("世界面板", () => {
  it("最新出现的在最上面，没看过的标“新”", () => {
    const s = pickAndRead(initialState(), 0);
    const entries = worldEntries(s);
    assert.deepEqual(
      entries.map((e) => e.id),
      ["log", "grey", "bell", "keeper", "tower", "pier", "me"],
    );
    assert.ok(entries.every((e) => e.isNew));
    assert.equal(entries.at(-1)?.kindLabel, "我");
  });

  it("收起面板以后都算看过了；之后新出现的才标“新”", () => {
    const seen = seenWorld(initialState());
    assert.deepEqual(seen.fresh, []);
    const s = pickAndRead(seen, 0);
    assert.deepEqual(
      worldEntries(s)
        .filter((e) => e.isNew)
        .map((e) => e.id),
      ["log", "grey"],
    );
  });

  it("“舱门后的人”原来是阿潮：去掉前者，阿潮标“更新”", () => {
    let s = pickAndRead(initialState(), 1);
    assert.ok(s.found.includes("voice"));
    s = pickAndRead(s, 0);
    assert.ok(!s.found.includes("voice"));
    const chao = worldEntries(s).find((e) => e.id === "chao");
    assert.equal(chao?.isUpd, true);
    assert.equal(chao?.isNew, false);
  });
});

describe("自己写", () => {
  it("发出去的一句去掉首尾空白；空的不发", () => {
    assert.equal(send(initialState(), "  我转身离开 ").typed, "我转身离开");
    const s = initialState();
    assert.equal(send(s, "  "), s);
  });

  it("进入下一段时清掉", () => {
    const s = advance(choose(send(initialState(), "我转身离开"), 0), false);
    assert.equal(s.typed, "");
  });
});

describe("begin 和 finish", () => {
  it("同一段写两次 finish，条目不重复", () => {
    const s = finish(finish(begin(initialState(), "root", false)));
    assert.deepEqual(s.found, ["me", "pier", "tower", "keeper", "bell"]);
  });
});
