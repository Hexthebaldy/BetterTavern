/** 三份文案的结构一样：类型检查管键，这里再看列表的长度一样、没有空字符串、占位一样 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPIES } from "./all.ts";

/** 把文案摊平成 路径 → 值 */
function flatten(value: unknown, path = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  }
  else out.set(path, value);
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const codeSpans = (s: string) => (s.match(/`/g) ?? []).length;

const zh = flatten(COPIES.zh);

describe("三份文案对得上", () => {
  for (const lang of ["en", "ja"] as const) {
    const other = flatten(COPIES[lang]);

    it(`${lang}：和中文的路径一一对应`, () => {
      assert.deepEqual([...other.keys()].sort(), [...zh.keys()].sort());
    });

    it(`${lang}：占位和行内代码和中文一样`, () => {
      for (const [path, value] of zh) {
        if (typeof value !== "string") continue;
        const v = other.get(path) as string;
        assert.deepEqual(placeholders(v), placeholders(value), `${lang} ${path}`);
        assert.equal(codeSpans(v), codeSpans(value), `${lang} ${path}`);
      }
    });
  }

  it("没有空字符串（中文页的 docsLangNote 和关系的前后半句除外）", () => {
    for (const [lang, copy] of Object.entries(COPIES)) {
      for (const [path, value] of flatten(copy)) {
        if (path === "docsLangNote" && lang === "zh") continue;
        if (/\.(fromA|fromB)\[[02]\]$/.test(path)) continue;
        if (typeof value === "string") assert.ok(value.trim(), `${lang} ${path}`);
      }
    }
  });

  it("英文和日文页上有“文档只有中文”的说明", () => {
    assert.ok(COPIES.en.docsLangNote);
    assert.ok(COPIES.ja.docsLangNote);
  });
});
