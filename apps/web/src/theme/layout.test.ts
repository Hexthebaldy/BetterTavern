import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptsSingleKey,
  contextMenuFrame,
  documentTitle,
  optionIndexForKey,
  SHORTCUTS,
  tooltipFrame,
  usesWheel,
  worldMode,
} from "./layout.ts";

describe("导航和世界面板的形态", () => {
  it("窗口 ≥ 900 用轮盘，更窄是底部 Tab 栏", () => {
    assert.equal(usesWheel(899), false);
    assert.equal(usesWheel(900), true);
    assert.equal(usesWheel(1920), true);
  });

  it("世界从右侧滑出，手机宽度是底部面板", () => {
    assert.equal(worldMode(1440), "slideOver");
    assert.equal(worldMode(600), "slideOver");
    assert.equal(worldMode(599), "sheet");
  });
});

describe("右键菜单与提示的位置", () => {
  const win = { width: 1440, height: 900 };

  it("左上角在鼠标处", () => {
    assert.deepEqual(contextMenuFrame({ x: 100, y: 100 }, win, 200), { left: 100, top: 100 });
  });

  it("右边、下边放不下时翻到鼠标的左边、上边", () => {
    assert.deepEqual(contextMenuFrame({ x: 1400, y: 800 }, win, 200), { left: 1160, top: 600 });
  });

  it("离窗口边至少 8", () => {
    assert.deepEqual(contextMenuFrame({ x: 2, y: 3 }, win, 200), { left: 8, top: 8 });
  });

  it("提示默认在元素上方 8、水平居中；上面放不下就放下面", () => {
    const tip = { width: 80, height: 32 };
    assert.deepEqual(tooltipFrame({ x: 100, y: 100, width: 40, height: 40 }, tip, win), {
      left: 80,
      top: 60,
      above: true,
    });
    assert.deepEqual(tooltipFrame({ x: 100, y: 10, width: 40, height: 40 }, tip, win), {
      left: 80,
      top: 58,
      above: false,
    });
    assert.equal(tooltipFrame({ x: 1430, y: 100, width: 10, height: 10 }, tip, win).left, 1352);
  });
});

describe("键盘快捷键", () => {
  const plain = { enabled: true, typing: false, composing: false, meta: false, ctrl: false, alt: false };

  it("单键快捷键只在开关打开、不在输入、没按修饰键、没在组字时响应", () => {
    assert.equal(acceptsSingleKey(plain), true);
    for (const change of [
      { enabled: false },
      { typing: true },
      { composing: true },
      { meta: true },
      { ctrl: true },
      { alt: true },
    ]) {
      assert.equal(acceptsSingleKey({ ...plain, ...change }), false, JSON.stringify(change));
    }
  });

  it("A–D 对应第几个选项，超出选项个数时不算", () => {
    assert.equal(optionIndexForKey("a", 2), 0);
    assert.equal(optionIndexForKey("B", 2), 1);
    assert.equal(optionIndexForKey("c", 2), null);
    assert.equal(optionIndexForKey("D", 4), 3);
    assert.equal(optionIndexForKey("x", 4), null);
  });

  it("快捷键表里单键的那些可以被开关关掉", () => {
    const single = SHORTCUTS.filter((s) => s.single).flatMap((s) => s.keys);
    assert.deepEqual(single, ["A", "B", "C", "D", "/", "W", "L", "Q", "1–6", "?"]);
  });
});

describe("标签页标题", () => {
  it("生成中在前面加圆点", () => {
    assert.equal(documentTitle("雨夜渡口", false), "雨夜渡口 · BetterTavern");
    assert.equal(documentTitle("雨夜渡口", true), "● 雨夜渡口 · BetterTavern");
    assert.equal(documentTitle(null, false), "BetterTavern");
  });
});
