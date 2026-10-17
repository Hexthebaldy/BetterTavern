import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ScenarioCard } from "../api/types.ts";
import {
  CARD_LIMITS,
  charCount,
  checkDraft,
  describeField,
  draftFrom,
  isDirty,
  moveEntry,
  newEntry,
  splitList,
  toInput,
  type CardDraft,
} from "./cardEdit.ts";

const DETAIL: ScenarioCard = {
  scenario_id: "s1",
  version: 3,
  edited_at: null,
  display_name: "雨夜阿苓",
  card: {
    name: "阿苓",
    description: "{{char}} 是酒馆的帮工",
    personality: "嘴硬心软",
    scenario: "",
    first_mes: "外乡人？",
    mes_example: "",
    tags: ["酒馆", "雨夜"],
    book: [
      { name: "渡口", keys: ["子时", "船"], content: "子时才有船", enabled: true, constant: true },
      { name: "", keys: [], content: "北境商会的火漆是黑色的", enabled: false, constant: false },
    ],
  },
  truncated_fields: [],
};

describe("编辑角色卡", () => {
  it("草稿和保存的请求互相转换：标签、关键词用一个输入框编辑", () => {
    const draft = draftFrom(DETAIL);
    assert.equal(draft.tags, "酒馆，雨夜");
    assert.equal(draft.book[0]?.keys, "子时，船");
    const input = toInput({ ...draft, tags: "酒馆、雨夜, 渡口\n酒馆", displayName: "  新名字 " }, 3);
    assert.equal(input.version, 3);
    assert.equal(input.display_name, "新名字");
    assert.deepEqual(input.card.tags, ["酒馆", "雨夜", "渡口"]);
    assert.deepEqual(input.card.book[0], DETAIL.card.book[0]);
    assert.deepEqual(input.card.book[1], DETAIL.card.book[1]);
  });

  it("改过没有：空白和分隔符写法不算改动", () => {
    const original = draftFrom(DETAIL);
    assert.equal(isDirty(original, draftFrom(DETAIL)), false);
    assert.equal(isDirty(original, { ...original, tags: " 酒馆 , 雨夜 " }), false);
    assert.equal(isDirty(original, { ...original, description: `${original.description}\n` }), false);
    assert.equal(isDirty(original, { ...original, description: "改了" }), true);
    assert.equal(isDirty(original, { ...original, book: original.book.slice(1) }), true);
    assert.equal(isDirty(original, { ...original, book: moveEntry(original.book, 0, 1) }), true);
  });

  it("保存前的检查和服务端一样，指出是哪个字段", () => {
    const draft = draftFrom(DETAIL);
    assert.deepEqual(checkDraft(draft), []);
    const bad: CardDraft = {
      ...draft,
      displayName: " ",
      name: "",
      personality: "字".repeat(CARD_LIMITS.field + 1),
      tags: Array.from({ length: 33 }, (_, i) => `标签${i}`).join("，"),
      book: [...draft.book, newEntry()],
    };
    assert.deepEqual(
      checkDraft(bad).map((p) => p.field),
      ["display_name", "name", "personality", "tags", "book.2.content"],
    );
  });

  it("字数按字符算：emoji 算一个", () => {
    assert.equal(charCount("你好😀"), 3);
    const name = "😀".repeat(CARD_LIMITS.name);
    assert.deepEqual(checkDraft({ ...draftFrom(DETAIL), name }), []);
  });

  it("文字总量超限", () => {
    const big = "字".repeat(CARD_LIMITS.field);
    const draft: CardDraft = {
      ...draftFrom(DETAIL),
      description: big,
      personality: big,
      scenario: big,
      first_mes: big,
      mes_example: big,
    };
    assert.deepEqual(
      checkDraft(draft).map((p) => p.field),
      ["card"],
    );
  });

  it("世界书条目上下移动，到头了不动", () => {
    const book = draftFrom(DETAIL).book;
    const moved = moveEntry(book, 1, -1);
    assert.deepEqual(
      moved.map((e) => e.content),
      ["北境商会的火漆是黑色的", "子时才有船"],
    );
    assert.equal(moveEntry(book, 0, -1), book);
    assert.equal(moveEntry(book, 1, 1), book);
  });

  it("给人看的字段名", () => {
    assert.equal(describeField("book.3.content"), "世界书第 4 条的内容");
    assert.equal(describeField("first_mes"), "开场白");
    assert.equal(describeField("card"), "整张卡");
    assert.deepEqual(splitList(" a ,, b，a "), ["a", "b"]);
  });
});
