import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TurnImage } from "../api/types.ts";
import {
  drawingImages,
  imageErrorKey,
  imageStyleKey,
  imagesByTurn,
  pictureOf,
  withImage,
  withoutImage,
} from "./illustrations.ts";

function image(id: string, status: TurnImage["status"], second: number, turnId = "t1"): TurnImage {
  return {
    id,
    turn_id: turnId,
    status,
    blob_id: status === "ready" ? `blob-${id}` : null,
    width: null,
    height: null,
    error: status === "failed" ? "timeout" : null,
    request: "",
    style: "",
    prompt: null,
    created_at: `2026-10-30T00:00:${String(second).padStart(2, "0")}Z`,
  };
}

describe("故事配图", () => {
  it("一回合的图怎么显示：画好的那张、正在画的、比画好的那张新的失败", () => {
    assert.deepEqual(pictureOf(undefined), { shown: null, drawing: null, failed: null });
    const ready = image("a", "ready", 1);
    assert.equal(pictureOf([ready]).shown, ready);
    const drawing = image("b", "pending", 2);
    assert.deepEqual(pictureOf([ready, drawing]), { shown: ready, drawing, failed: null });
    // 重画失败：旧图照样显示，下面写原因
    const failed = image("c", "failed", 3);
    assert.deepEqual(pictureOf([ready, failed]), { shown: ready, drawing: null, failed });
    // 比画好的那张旧的失败记录不显示
    assert.equal(pictureOf([image("d", "failed", 0), ready]).failed, null);
  });

  it("新的一张画好时，旧图和失败的记录都不要了；再画一次时去掉失败的记录", () => {
    const old = image("a", "ready", 1);
    const failed = image("b", "failed", 2);
    const drawing = image("c", "pending", 3);
    assert.deepEqual(withImage([old, failed], drawing), [old, drawing]);
    assert.deepEqual(withImage([old, drawing], image("c", "ready", 3)), [image("c", "ready", 3)]);
    assert.deepEqual(withImage([old, drawing], image("c", "failed", 3)), [old, image("c", "failed", 3)]);
    assert.deepEqual(withoutImage([old, drawing], "a"), [drawing]);
  });

  it("还在画的图、按回合分好、界面文字的键", () => {
    const byTurn = imagesByTurn([
      { id: "t1", images: [image("a", "ready", 1), image("b", "pending", 2)] },
      { id: "t2", images: [] },
      { id: "t3" },
    ]);
    assert.deepEqual(Object.keys(byTurn), ["t1"]);
    assert.deepEqual(
      drawingImages(byTurn).map((i) => i.id),
      ["b"],
    );
    assert.equal(imageStyleKey(""), "play.imageStyles.none");
    assert.equal(imageStyleKey("anime"), "play.imageStyles.anime");
    assert.equal(imageErrorKey("timeout"), "play.imageErrors.timeout");
    assert.equal(imageErrorKey("bad_response"), "play.imageErrors.service");
    assert.equal(imageErrorKey(null), "play.imageErrors.service");
  });
});
