import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyLanguage } from "../i18n/index.ts";
import {
  BOUNDARIES_MAX,
  composeBoundaries,
  composeStyle,
  namePool,
  needsDirector,
  randomName,
  STYLE_MAX,
  suggestNames,
  summaryParts,
} from "./startForm.ts";

describe("开始新故事的表单", () => {
  it("名字建议不重复", () => {
    const names = suggestNames(4, () => 0);
    assert.equal(new Set(names).size, 4);
    assert.ok(names.every((n) => namePool().includes(n)));
  });

  it("随机名字和当前的不同", () => {
    for (let i = 0; i < 10; i += 1)
      assert.notEqual(
        randomName("林川", () => i / 10),
        "林川",
      );
  });

  it("文风和边界用顿号连起来，超出上限的整项丢掉", () => {
    assert.equal(composeStyle(["克制", " 白描 ", ""]), "克制、白描");
    const long = Array.from({ length: 80 }, (_, i) => `风格${i}`);
    const style = composeStyle(long);
    assert.ok(style.length <= STYLE_MAX);
    assert.ok(style.endsWith(`风格${style.split("、").length - 1}`));
    assert.ok(composeBoundaries(long).length <= BOUNDARIES_MAX);
  });

  it("底部摘要分段", () => {
    assert.deepEqual(
      summaryParts({ name: "林川", length: "medium", styles: ["克制", "白描"], boundaries: 2 }),
      ["林川", "适中", "克制 · 白描", "避开 2 项"],
    );
    assert.deepEqual(summaryParts({ name: " ", length: "short", styles: [], boundaries: 0 }), [
      "还没起名",
      "短",
    ]);
  });

  it("日文界面：日文名字、读点分隔、日文摘要", () => {
    applyLanguage("ja");
    try {
      // 名字是汉字加假名，不出现中文专用的简体字
      assert.ok(suggestNames(3, () => 0).every((n) => n.length > 0 && !/[们这说]/.test(n)));
      assert.equal(composeStyle(["詩的", "軽やか"]), "詩的、軽やか");
      assert.deepEqual(summaryParts({ name: "", length: "long", styles: ["詩的"], boundaries: 1 }), [
        "名前はまだありません",
        "長め",
        "詩的",
        "1 件を避ける",
      ]);
    } finally {
      applyLanguage("zh");
    }
  });

  it("英文界面：英文名字、逗号分隔、英文摘要", () => {
    applyLanguage("en");
    try {
      assert.ok(suggestNames(3, () => 0).every((n) => /^[A-Za-z]+$/.test(n)));
      assert.equal(composeStyle(["Restrained", "Spare"]), "Restrained, Spare");
      assert.deepEqual(summaryParts({ name: "", length: "long", styles: ["Poetic"], boundaries: 1 }), [
        "No name yet",
        "Long",
        "Poetic",
        "Avoid 1 item",
      ]);
      assert.equal(
        summaryParts({ name: "Ada", length: "medium", styles: [], boundaries: 3 })[2],
        "Avoid 3 items",
      );
    } finally {
      applyLanguage("zh");
    }
  });
});

describe("needsDirector", () => {
  it("取到了列表、没有导演时提示；有导演或取不到列表时不提示", () => {
    assert.equal(needsDirector([]), true);
    assert.equal(needsDirector([{ is_director: false }, { is_director: false }]), true);
    assert.equal(needsDirector([{ is_director: false }, { is_director: true }]), false);
    assert.equal(needsDirector(undefined), false);
  });
});
