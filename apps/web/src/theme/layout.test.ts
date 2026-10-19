import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptsSingleKey,
  contextMenuFrame,
  documentTitle,
  navMode,
  navWidth,
  optionIndexForKey,
  optionKeyAction,
  pageFrame,
  readingArea,
  readingLayout,
  settingsFrame,
  SHORTCUTS,
  sidebarOverlays,
  tooltipFrame,
} from "./layout.ts";

describe("导航形态", () => {
  it("< 900 是底部 Tab 栏，900–1279 是导航条，≥ 1280 是侧栏；收起后是导航条", () => {
    assert.equal(navMode(899, false), "tabbar");
    assert.equal(navMode(900, false), "rail");
    assert.equal(navMode(1279, false), "rail");
    assert.equal(navMode(1280, false), "sidebar");
    assert.equal(navMode(1920, true), "rail");
    assert.equal(navMode(600, true), "tabbar");
  });

  it("导航占掉的宽度含离窗口边的 12", () => {
    assert.equal(navWidth("sidebar"), 280);
    assert.equal(navWidth("rail"), 88);
    assert.equal(navWidth("tabbar"), 0);
  });

  it("窄于 1280 时展开的侧栏盖在内容上", () => {
    assert.equal(sidebarOverlays(1000), true);
    assert.equal(sidebarOverlays(1280), false);
    assert.equal(sidebarOverlays(800), false);
  });
});

describe("一级页的内容区", () => {
  it("1440 宽、侧栏展开时从 320 开始，宽 1080", () => {
    assert.deepEqual(pageFrame(1440, "sidebar"), { left: 320, width: 1080 });
  });

  it("超过 1200 后居中", () => {
    assert.deepEqual(pageFrame(1920, "sidebar"), { left: 500, width: 1200 });
  });

  it("窗口再窄也不会是负宽度", () => {
    assert.equal(pageFrame(100, "rail").width, 0);
  });
});

describe("阅读页", () => {
  it("没打开世界时只看导航", () => {
    assert.deepEqual(readingLayout(1440, false, false), { nav: "sidebar", world: null });
  });

  it("窗口 − 侧栏 ≥ 1100 时世界停靠", () => {
    assert.deepEqual(readingLayout(1380, false, true), { nav: "sidebar", world: "dock" });
  });

  it("1188–1379：侧栏临时收成导航条，世界停靠", () => {
    assert.deepEqual(readingLayout(1379, false, true), { nav: "rail", world: "dock" });
    assert.deepEqual(readingLayout(1188, false, true), { nav: "rail", world: "dock" });
  });

  it("再窄就从右侧滑出；手机宽度是底部面板", () => {
    assert.deepEqual(readingLayout(1187, false, true), { nav: "rail", world: "slideOver" });
    assert.deepEqual(readingLayout(800, false, true), { nav: "tabbar", world: "slideOver" });
    assert.deepEqual(readingLayout(599, false, true), { nav: "tabbar", world: "sheet" });
  });

  it("阅读区在导航和停靠的世界之间", () => {
    assert.deepEqual(readingArea(1440, "sidebar", "dock"), { left: 280, width: 748 });
    assert.deepEqual(readingArea(1440, "sidebar", "slideOver"), { left: 280, width: 1160 });
    assert.deepEqual(readingArea(500, "tabbar", null), { left: 0, width: 500 });
  });
});

describe("设置两栏", () => {
  it("1440 宽时右栏从 684 开始、宽 744，分两栏", () => {
    assert.deepEqual(settingsFrame(1440, "sidebar"), {
      listLeft: 320,
      paneLeft: 684,
      paneWidth: 744,
      twoColumns: true,
    });
  });

  it("1280 宽时右栏 584，不分", () => {
    const frame = settingsFrame(1280, "sidebar");
    assert.equal(frame.paneWidth, 584);
    assert.equal(frame.twoColumns, false);
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

  it("单键选项：字母只选中，Enter 发出选中的那一项，Esc 取消；没选中时 Enter、Esc 与选项无关", () => {
    assert.deepEqual(optionKeyAction("b", null, 2), { arm: 1 });
    // 再按另一个字母，选中换成那一个
    assert.deepEqual(optionKeyAction("a", 1, 2), { arm: 0 });
    assert.deepEqual(optionKeyAction("Enter", 1, 2), { send: 1 });
    assert.deepEqual(optionKeyAction("Escape", 1, 2), { clear: true });
    assert.equal(optionKeyAction("Enter", null, 2), null);
    assert.equal(optionKeyAction("Escape", null, 2), null);
    // 打拼音“wo da”：d 超出两个选项不算，a 只选中
    assert.equal(optionKeyAction("d", null, 2), null);
    assert.deepEqual(optionKeyAction("a", null, 2), { arm: 0 });
    // 选项变少了，原来选中的超出范围：当作没选中
    assert.equal(optionKeyAction("Enter", 3, 2), null);
    assert.equal(optionKeyAction("x", null, 4), null);
  });

  it("快捷键表里单键的那些可以被开关关掉", () => {
    const single = SHORTCUTS.filter((s) => s.single).flatMap((s) => s.keys);
    assert.deepEqual(single, ["A", "B", "C", "D", "/", "W", "[", "?"]);
  });
});

describe("标签页标题", () => {
  it("生成中在前面加圆点", () => {
    assert.equal(documentTitle("雨夜渡口", false), "雨夜渡口 · BetterTavern");
    assert.equal(documentTitle("雨夜渡口", true), "● 雨夜渡口 · BetterTavern");
    assert.equal(documentTitle(null, false), "BetterTavern");
  });
});
