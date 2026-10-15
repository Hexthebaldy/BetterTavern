import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  actionPanelFrame,
  cardMenuFrame,
  cellWidth,
  centerColumn,
  libraryColumns,
  locksPortrait,
  optionColumns,
  overlayPresentation,
  pageColumn,
  popoverFrame,
  readableColumn,
  readingWidth,
  sizeClass,
  storyColumns,
  tabInsets,
  toastFrame,
  worldPresentation,
} from "./layout.ts";

describe("平板布局", () => {
  it("只按窗口宽度分档：手机、iPad 竖屏、横屏、分屏", () => {
    assert.equal(sizeClass(390), "compact");
    assert.equal(sizeClass(599), "compact");
    assert.equal(sizeClass(600), "medium");
    assert.equal(sizeClass(834), "medium");
    assert.equal(sizeClass(899), "medium");
    assert.equal(sizeClass(900), "expanded");
    assert.equal(sizeClass(1032), "expanded");
    assert.equal(sizeClass(1194), "expanded");
    // iPad 横屏分屏一半（约 590）是窄屏
    assert.equal(sizeClass(590), "compact");
  });

  it("手机锁竖屏，平板不锁；看的是屏幕短边，横着拿也一样", () => {
    assert.equal(locksPortrait({ width: 390, height: 844 }), true);
    assert.equal(locksPortrait({ width: 932, height: 430 }), true);
    assert.equal(locksPortrait({ width: 744, height: 1133 }), false);
    assert.equal(locksPortrait({ width: 1194, height: 834 }), false);
  });

  it("世界状态：≥ 1100 停靠，13 寸竖屏（1032）滑出，手机底部面板", () => {
    assert.equal(worldPresentation(1194), "dock");
    assert.equal(worldPresentation(1100), "dock");
    assert.equal(worldPresentation(1032), "slideOver");
    assert.equal(worldPresentation(834), "slideOver");
    assert.equal(worldPresentation(390), "sheet");
  });

  it("底部面板在平板上换成对话框或贴按钮的菜单，手机不变", () => {
    assert.equal(overlayPresentation("choice", "compact"), "sheet");
    assert.equal(overlayPresentation("menu", "compact"), "sheet");
    assert.equal(overlayPresentation("choice", "medium"), "dialog");
    assert.equal(overlayPresentation("menu", "expanded"), "popover");
  });

  it("列数：故事 1 / 2 / 3；剧本宽屏按 240 一列，2 到 5 列", () => {
    assert.deepEqual(
      ["compact", "medium", "expanded"].map((s) => storyColumns(s as never)),
      [1, 2, 3],
    );
    assert.equal(libraryColumns("compact", 366), 2);
    assert.equal(libraryColumns("medium", 770), 3);
    assert.equal(libraryColumns("expanded", 1030), 4);
    assert.equal(libraryColumns("expanded", 2000), 5);
    assert.equal(libraryColumns("expanded", 300), 2);
    assert.equal(optionColumns("expanded"), 2);
    assert.equal(optionColumns("medium"), 1);
  });

  it("阅读栏最宽 640 居中；手机上就是左右各 24", () => {
    assert.deepEqual(readableColumn(390), { left: 24, width: 342 });
    assert.deepEqual(readableColumn(1194), { left: 277, width: 640 });
    // 停靠时在剩下的宽度里居中
    assert.equal(readingWidth(1194, true), 786);
    assert.deepEqual(readableColumn(readingWidth(1194, true)), { left: 73, width: 640 });
  });

  it("行动面板最宽 672、和阅读栏同一条中线；手机上左右各离边 8", () => {
    assert.deepEqual(actionPanelFrame(390), { left: 8, width: 374 });
    assert.deepEqual(actionPanelFrame(1194), { left: 261, width: 672 });
    const panel = actionPanelFrame(834);
    const column = readableColumn(834);
    assert.equal(panel.left + panel.width / 2, column.left + column.width / 2);
  });

  it("一级页的留白：手机不管，中屏两侧 32，宽屏让出导航栏", () => {
    assert.equal(tabInsets("compact"), null);
    assert.deepEqual(tabInsets("medium"), { left: 32, right: 32 });
    assert.deepEqual(tabInsets("expanded"), { left: 124, right: 40 });
    // 列表视图、单栏页面在内容区里居中，最宽 640
    assert.deepEqual(centerColumn(834, { left: 32, right: 32 }), { left: 97, right: 97 });
    assert.deepEqual(centerColumn(700, { left: 32, right: 32 }), { left: 32, right: 32 });
    assert.equal(pageColumn("compact", 390), null);
    assert.deepEqual(pageColumn("medium", 834), { left: 97, right: 97 });
  });

  it("网格每格宽度取整，几格加间距不超出一行", () => {
    const w = cellWidth(1030, 3, 12);
    assert.ok(w * 3 + 24 <= 1030);
    assert.equal(cellWidth(366, 2, 8), 179);
  });

  it("提示浮条：中屏在 Tab 栏上方居中，宽屏在内容区居中，最宽 480", () => {
    assert.equal(toastFrame("compact", 390), null);
    assert.deepEqual(toastFrame("medium", 834), { left: 177, width: 480, aboveTabBar: true });
    const wide = toastFrame("expanded", 1194);
    assert.ok(wide && wide.left >= 124 && wide.width === 480 && !wide.aboveTabBar);
  });

  it("“更多”菜单：右边和按钮对齐，底边在面板上方 8，不出窗口", () => {
    const window = { width: 1194, height: 834 };
    const frame = popoverFrame({ x: 880, y: 760, width: 44, height: 44 }, window, 700);
    assert.equal(frame.left + frame.width, 924);
    assert.equal(frame.bottom, 834 - 700 + 8);
    // 按钮靠左时不超出左边
    assert.equal(popoverFrame({ x: 10, y: 760, width: 44, height: 44 }, window, 700).left, 16);
  });

  it("长按卡片的菜单放在卡片下面，放不下就放到上面", () => {
    const window = { width: 1194, height: 834 };
    const below = cardMenuFrame({ x: 124, y: 200, width: 320, height: 180 }, window, 120, 20);
    assert.deepEqual(below, { left: 124, top: 388, width: 240 });
    const above = cardMenuFrame({ x: 124, y: 600, width: 320, height: 180 }, window, 120, 20);
    assert.equal(above.top, 600 - 8 - 120);
  });
});
