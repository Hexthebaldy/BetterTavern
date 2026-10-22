import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterCard } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";
import {
  blocking,
  CARD_LIMITS,
  charCount,
  checkCard,
  describeField,
  describeIssue,
  draftOf,
  isDirty,
  moveEntry,
  moveItem,
  newEntry,
  newGreeting,
  splitList,
  toInput,
  type CardDraft,
} from "./cardEdit.ts";

const CARD: CharacterCard = {
  name: "阿苓",
  description: "{{char}} 是酒馆的帮工",
  personality: "嘴硬心软",
  scenario: "",
  first_mes: "外乡人？",
  mes_example: "",
  system_prompt: "",
  creator_notes: "",
  alternate_greetings: ["雨停了。"],
  tags: ["酒馆", "雨夜"],
  book: [
    { name: "渡口", keys: ["子时", "船"], content: "子时才有船", enabled: true, constant: true },
    { name: "", keys: [], content: "北境商会的火漆是黑色的", enabled: false, constant: false },
  ],
  creator: "",
  character_version: "",
  post_history_instructions: "",
  truncated: [],
};

const codes = (draft: CardDraft) => checkCard(draft).map((i) => `${i.field}:${i.code}:${i.level}`);

describe("编辑角色卡", () => {
  void i18n.changeLanguage("zh");

  it("草稿和自动保存的请求互相转换：标签、关键词用一个输入框编辑", () => {
    const draft = draftOf(CARD, "雨夜阿苓");
    assert.equal(draft.tags, "酒馆，雨夜");
    assert.equal(draft.book[0]?.keys, "子时，船");
    assert.equal(draft.greetings[0]?.text, "雨停了。");
    const input = toInput({ ...draft, tags: "酒馆、雨夜, 渡口\n酒馆", displayName: "  新名字 " });
    assert.equal(input.name, "新名字");
    assert.deepEqual(input.card.tags, ["酒馆", "雨夜", "渡口"]);
    assert.deepEqual(input.card.alternate_greetings, ["雨停了。"]);
    assert.deepEqual(input.card.book[0], CARD.book[0]);
    assert.deepEqual(input.card.book[1], CARD.book[1]);
  });

  it("改过没有：空白和分隔符写法不算改动", () => {
    const original = draftOf(CARD, "雨夜阿苓");
    assert.equal(isDirty(original, draftOf(CARD, "雨夜阿苓")), false);
    assert.equal(isDirty(original, { ...original, tags: " 酒馆 , 雨夜 " }), false);
    assert.equal(isDirty(original, { ...original, description: `${original.description}\n` }), false);
    assert.equal(isDirty(original, { ...original, description: "改了" }), true);
    assert.equal(isDirty(original, { ...original, creator_notes: "备注" }), true);
    assert.equal(isDirty(original, { ...original, greetings: [] }), true);
    assert.equal(isDirty(original, { ...original, book: moveEntry(original.book, 0, 1) }), true);
  });

  it("检查和服务端用同一套 code：error 挡住保存，warning 只提醒", () => {
    const draft = draftOf(CARD, "雨夜阿苓");
    // 第 2 条世界书不启用，没有关键词也不算永远用不到
    assert.deepEqual(codes(draft), []);
    const bad: CardDraft = {
      ...draft,
      displayName: " ",
      name: "",
      personality: "字".repeat(CARD_LIMITS.field + 1),
      tags: Array.from({ length: 33 }, (_, i) => `标签${i}`).join("，"),
      greetings: [...draft.greetings, newGreeting("")],
      book: [...draft.book, newEntry()],
    };
    assert.deepEqual(
      blocking(checkCard(bad)).map((i) => `${i.field}:${i.code}`),
      [
        "display_name:display_name_empty",
        "name:name_empty",
        "personality:field_too_long",
        "alternate_greetings.1:greeting_empty",
        "tags:too_many_tags",
        "book.2.content:entry_empty",
      ],
    );
    assert.ok(codes(bad).includes("book.2.keys:entry_unreachable:warning"));
  });

  it("提醒：没写描述和开场白、关键词重复、宏写错", () => {
    const draft: CardDraft = {
      ...draftOf(CARD, "阿苓"),
      description: "",
      first_mes: "",
      scenario: "{{usr}} 推门进来",
      mes_example: "{{char} 擦着杯子",
      book: [
        { ...newEntry(), name: "渡口", keys: "船", content: "子时才有船" },
        { ...newEntry(), name: "码头", keys: "船，码头", content: "码头在城东" },
      ],
    };
    const found = codes(draft);
    for (const expected of [
      "description:description_empty:warning",
      "first_mes:opening_empty:warning",
      "scenario:macro_unknown:warning",
      "mes_example:macro_broken:warning",
      "book.1.keys:key_duplicate:warning",
    ]) {
      assert.ok(found.includes(expected), expected);
    }
    const duplicate = checkCard(draft).find((i) => i.code === "key_duplicate")!;
    assert.equal(describeIssue(duplicate), "世界书第 2 条的关键词：关键词“船”和第 1 条重复");
    const macro = checkCard(draft).find((i) => i.code === "macro_unknown")!;
    assert.equal(describeIssue(macro), "情境：{{usr}} 开局时会被丢掉，只认 {{user}} 和 {{char}} 两种");
  });

  it("显示名空着时用角色名；字数按字符算：emoji 算一个", () => {
    assert.deepEqual(codes({ ...draftOf(CARD, ""), displayName: "" }), []);
    assert.equal(charCount("你好😀"), 3);
    const name = "😀".repeat(CARD_LIMITS.name);
    assert.deepEqual(codes({ ...draftOf(CARD, "阿苓"), name }), []);
  });

  it("文字总量超限", () => {
    const big = "字".repeat(CARD_LIMITS.field);
    const draft: CardDraft = {
      ...draftOf(CARD, "阿苓"),
      description: big,
      personality: big,
      scenario: big,
      first_mes: big,
      mes_example: big,
    };
    assert.deepEqual(
      blocking(checkCard(draft)).map((i) => i.field),
      ["card"],
    );
  });

  it("世界书条目、开场白上下移动，到头了不动", () => {
    const book = draftOf(CARD, "").book;
    const moved = moveEntry(book, 1, -1);
    assert.deepEqual(
      moved.map((e) => e.content),
      ["北境商会的火漆是黑色的", "子时才有船"],
    );
    assert.equal(moveEntry(book, 0, -1), book);
    assert.equal(moveEntry(book, 1, 1), book);
    assert.deepEqual(moveItem(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  });

  it("给人看的字段名", () => {
    assert.equal(describeField("book.3.content"), "世界书第 4 条的内容");
    assert.equal(describeField("alternate_greetings.0"), "第 1 条备选开场白");
    assert.equal(describeField("first_mes"), "开场白");
    assert.equal(describeField("creator_notes"), "作者备注");
    assert.equal(describeField("card"), "整张卡");
    assert.deepEqual(splitList(" a ,, b，a "), ["a", "b"]);
  });
});
