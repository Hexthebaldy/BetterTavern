import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  castOf,
  draftKey,
  firstLine,
  isSendKey,
  nextFollow,
  optionColumns,
  parseDraft,
  recapItems,
  recentNotes,
} from "./reading.ts";

describe("跟随新文字", () => {
  it("到了底部就跟随", () => {
    assert.deepEqual(nextFollow({ following: false, lastY: 100 }, { y: 900, distance: 10 }), {
      following: true,
      lastY: 900,
    });
  });

  it("往上翻就停止跟随", () => {
    assert.deepEqual(nextFollow({ following: true, lastY: 900 }, { y: 600, distance: 300 }), {
      following: false,
      lastY: 600,
    });
  });

  it("往下翻但没到底：保持原样（程序滚动、平滑滚动的中途不算翻走）", () => {
    assert.equal(nextFollow({ following: true, lastY: 600 }, { y: 700, distance: 200 }).following, true);
    assert.equal(nextFollow({ following: false, lastY: 600 }, { y: 700, distance: 200 }).following, false);
  });
});

describe("Enter 发送", () => {
  const key = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };

  it("Enter 发送，Shift + Enter 换行", () => {
    assert.equal(isSendKey(key), true);
    assert.equal(isSendKey({ ...key, shiftKey: true }), false);
    assert.equal(isSendKey({ ...key, key: "a", keyCode: 65 }), false);
  });

  it("输入法组字时的 Enter 是确认候选词", () => {
    assert.equal(isSendKey({ ...key, isComposing: true }), false);
    assert.equal(isSendKey({ ...key, keyCode: 229 }), false);
  });
});

describe("草稿", () => {
  it("每个故事一份，读到的不是文字就当没有", () => {
    assert.equal(draftKey("p1"), "bt.draft.p1");
    assert.equal(parseDraft("我推开门"), "我推开门");
    assert.equal(parseDraft(null), "");
    assert.equal(parseDraft(3), "");
  });
});

describe("回想列表", () => {
  const turns = [1, 2, 3, 4, 5, 6, 7].map((seq) => ({ id: `t${seq}`, seq, narrative: `第 ${seq} 段\n后面的话` }));

  it("默认最近五段，从旧到新", () => {
    assert.deepEqual(
      recapItems(turns, false).map((i) => i.seq),
      [3, 4, 5, 6, 7],
    );
  });

  it("展开时是全部", () => {
    assert.equal(recapItems(turns, true).length, 7);
  });

  it("只取第一句，太长截断", () => {
    assert.equal(firstLine("\n\n  雨是从傍晚开始下的。\n第二段"), "雨是从傍晚开始下的。");
    assert.equal(firstLine("一二三四五六", 4), "一二三四…");
    assert.equal(firstLine(""), "");
  });
});

describe("右栏", () => {
  const e = (id: string, kind: string, hero = false) => ({ id, kind, name: id, summary: "", is_protagonist: hero });

  it("人物：主角在最前，最多四个，不含地点和物品", () => {
    const cast = castOf([e("a", "character"), e("inn", "location"), e("me", "character", true), e("b", "character"), e("c", "character"), e("d", "character")]);
    assert.deepEqual(
      cast.map((x) => x.id),
      ["me", "a", "b", "c"],
    );
  });

  it("刚记下的：最后一个地点、最后两条不是秘密的事实、秘密的条数", () => {
    const notes = recentNotes({
      entities: [e("inn", "location"), e("pier", "location"), e("a", "character")],
      facts: [
        { id: "f1", text: "一", secret: false },
        { id: "f2", text: "二", secret: false },
        { id: "s", text: "秘", secret: true },
        { id: "f3", text: "三", secret: false },
      ],
      hidden_facts: 2,
    });
    assert.equal(notes.place?.id, "pier");
    assert.deepEqual(
      notes.facts.map((f) => f.id),
      ["f2", "f3"],
    );
    assert.equal(notes.hidden, 2);
  });

  it("没有地点时是 null", () => {
    assert.equal(recentNotes({ entities: [], facts: [], hidden_facts: 0 }).place, null);
  });
});

describe("选项卡的列数", () => {
  it("三张以内一行，四张两行", () => {
    assert.equal(optionColumns(2), 2);
    assert.equal(optionColumns(3), 3);
    assert.equal(optionColumns(4), 2);
  });
});
