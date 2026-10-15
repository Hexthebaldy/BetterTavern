import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coverArt, coverRadius, motifFor } from "./cover.ts";

describe("motifFor", () => {
  it("returns the same motif for the same seed", () => {
    assert.equal(motifFor("sc_01"), motifFor("sc_01"));
  });

  it("spreads seeds over all five motifs", () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => motifFor(`sc_${i}`)));
    assert.deepEqual([...seen].sort(), ["arch", "dial", "grid", "peak", "wave"]);
  });
});

describe("coverArt", () => {
  it("draws one blue dot inside the cover for every motif", () => {
    for (let i = 0; i < 50; i += 1) {
      for (const [w, h] of [
        [56, 56],
        [360, 220],
      ] as const) {
        const dots = coverArt(`sc_${i}`, w, h).shapes.filter((s) => s.tone === "focus");
        assert.equal(dots.length, 1);
        const dot = dots[0];
        assert.ok(dot?.kind === "circle");
        assert.ok(dot.cx > 0 && dot.cx < w && dot.cy > 0 && dot.cy < h);
      }
    }
  });

  it("keeps lines readable at small sizes and fixed on tall banners", () => {
    assert.equal(coverArt("a", 40, 40).strokeWidth, 1.4);
    assert.equal(coverArt("a", 400, 240).strokeWidth, 1.8);
    assert.ok(coverArt("a", 40, 40).softStrokeWidth >= 1);
  });
});

describe("coverRadius", () => {
  it("starts at 16 and stops at 34", () => {
    assert.equal(coverRadius(40, 40), 16);
    assert.equal(coverRadius(80, 80), 22);
    assert.equal(coverRadius(400, 300), 34);
  });
});
