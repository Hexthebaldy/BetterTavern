import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  castPage,
  castPages,
  GRID,
  pageLabel,
  savesPage,
  savesPages,
  scenariosPage,
  scenariosPages,
  turnPage,
  type Placed,
} from "./grid.ts";

/** 每一格都在 6 × 3 里面，格子之间不重叠；返回占掉的格数 */
function covered(cells: Placed<string>[]): number {
  const taken = new Set<string>();
  for (const { slot } of cells) {
    assert.ok(slot.col >= 1 && slot.col + slot.w - 1 <= GRID.cols, JSON.stringify(slot));
    assert.ok(slot.row >= 1 && slot.row + slot.h - 1 <= GRID.rows, JSON.stringify(slot));
    for (let c = slot.col; c < slot.col + slot.w; c++)
      for (let r = slot.row; r < slot.row + slot.h; r++) {
        const key = `${c},${r}`;
        assert.ok(!taken.has(key), `重叠 ${key}`);
        taken.add(key);
      }
  }
  return taken.size;
}

describe("存档的格子", () => {
  it("一页排满时和设计稿一样：最近的占左上 4 × 2，“新的故事”在下面一行中间", () => {
    const cells = savesPage(12, 0);
    assert.deepEqual(cells[0], { kind: "hero", item: 0, slot: { col: 1, row: 1, w: 4, h: 2 } });
    assert.deepEqual(
      cells.find((c) => c.kind === "new"),
      { kind: "new", item: null, slot: { col: 3, row: 3, w: 2, h: 1 } },
    );
    assert.deepEqual(
      cells.filter((c) => c.item !== null).map((c) => c.item),
      [0, 1, 2, 3, 4, 5],
    );
    assert.equal(covered(cells), 18);
  });

  it("第一页六个，之后每页九个", () => {
    assert.equal(savesPages(0), 1);
    assert.equal(savesPages(6), 1);
    assert.equal(savesPages(7), 2);
    assert.equal(savesPages(15), 2);
    assert.equal(savesPages(16), 3);
    assert.deepEqual(
      savesPage(16, 1).map((c) => c.item),
      [6, 7, 8, 9, 10, 11, 12, 13, 14],
    );
    assert.deepEqual(
      savesPage(16, 2).map((c) => c.item),
      [15],
    );
  });

  it("第一页不满时排满整页，不留空洞", () => {
    for (let n = 0; n <= 6; n++) {
      const cells = savesPage(n, 0);
      assert.equal(cells.filter((c) => c.item !== null).length, n, `n=${n}`);
      assert.equal(cells.filter((c) => c.kind === "new").length, 1, `n=${n}`);
      assert.equal(covered(cells), 18, `n=${n}`);
    }
  });

  it("后面的页格子不重叠", () => {
    covered(savesPage(40, 3));
  });

  it("页数越界时按最后一页算", () => {
    assert.deepEqual(savesPage(8, 9), savesPage(8, 1));
    assert.deepEqual(savesPage(8, -1), savesPage(8, 0));
  });
});

describe("剧本的格子", () => {
  it("一页排满时和设计稿一样：最近添加的占左边一整列，“新建剧本”在右下角", () => {
    const cells = scenariosPage(24, 0);
    assert.deepEqual(cells[0], { kind: "hero", item: 0, slot: { col: 1, row: 1, w: 3, h: 3 } });
    assert.deepEqual(
      cells.map((c) => c.kind),
      ["hero", "wide", "narrow", "narrow", "wide", "wide", "new"],
    );
    assert.deepEqual(cells.at(-1)?.slot, { col: 6, row: 3, w: 1, h: 1 });
    assert.equal(covered(cells), 18);
  });

  it("第一页六个，之后每页十二个，每行宽、窄、窄、宽", () => {
    assert.equal(scenariosPages(6), 1);
    assert.equal(scenariosPages(18), 2);
    assert.equal(scenariosPages(19), 3);
    const second = scenariosPage(18, 1);
    assert.equal(second.length, 12);
    assert.deepEqual(
      second.slice(0, 4).map((c) => c.kind),
      ["wide", "narrow", "narrow", "wide"],
    );
    assert.equal(covered(second), 18);
  });

  it("第一页不满时排满整页", () => {
    for (let n = 0; n <= 6; n++) {
      const cells = scenariosPage(n, 0);
      assert.equal(cells.filter((c) => c.item !== null).length, n, `n=${n}`);
      assert.equal(covered(cells), 18, `n=${n}`);
    }
  });
});

describe("角色的卡", () => {
  it("每页八张", () => {
    assert.equal(castPages(0), 1);
    assert.equal(castPages(8), 1);
    assert.equal(castPages(9), 2);
    assert.deepEqual(castPage(10, 1), [8, 9]);
    assert.deepEqual(castPage(3, 0), [0, 1, 2]);
    assert.deepEqual(castPage(0, 0), []);
  });
});

describe("翻页", () => {
  it("← → 翻页，到头了不动", () => {
    assert.equal(turnPage(0, 3, "ArrowRight"), 1);
    assert.equal(turnPage(2, 3, "ArrowRight"), 2);
    assert.equal(turnPage(0, 3, "ArrowLeft"), 0);
    assert.equal(turnPage(2, 3, "ArrowLeft"), 1);
    assert.equal(turnPage(1, 3, "Enter"), 1);
  });

  it("页码两位数", () => {
    assert.equal(pageLabel(0), "01");
    assert.equal(pageLabel(11), "12");
  });
});
