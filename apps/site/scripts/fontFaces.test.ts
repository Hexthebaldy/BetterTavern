import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { codePoints, parseUnicodeRange, pruneFontFaces } from "./fontFaces.ts";

describe("parseUnicodeRange", () => {
  it("单个码位、区间和通配", () => {
    assert.deepEqual(parseUnicodeRange("U+0000-00FF, U+4e00,U+1f1e9-1f1f5,U+4??"), [
      [0x0, 0xff],
      [0x4e00, 0x4e00],
      [0x1f1e9, 0x1f1f5],
      [0x400, 0x4ff],
    ]);
  });
});

const face = (name: string, range: string) => `/* ${name} */
@font-face {
  font-family: 'Noto Serif SC';
  font-weight: 700;
  src: url(./files/${name}.woff2) format('woff2'), url(./files/${name}.woff) format('woff');
  unicode-range: ${range};
}

`;

describe("pruneFontFaces", () => {
  const css = face("latin", "U+0000-00FF") + face("cjk-1", "U+4e00-4e10") + face("cjk-2", "U+9000-9010");

  it("只留下有字用得上的片", () => {
    const out = pruneFontFaces(css, codePoints(["Better 一"]));
    assert.match(out, /latin\.woff2/);
    assert.match(out, /cjk-1\.woff2/);
    assert.doesNotMatch(out, /cjk-2/);
  });

  it("去掉的片连同前面的注释一起去掉，其他内容不动", () => {
    const out = pruneFontFaces(`body{color:red}\n${css}`, codePoints(["A"]));
    assert.match(out, /^body\{color:red\}/);
    assert.equal(out.match(/@font-face/g)?.length, 1);
    assert.doesNotMatch(out, /cjk/);
  });

  it("去掉 woff 的备用地址，只留 woff2", () => {
    const out = pruneFontFaces(css, codePoints(["A"]));
    assert.match(out, /src: url\(\.\/files\/latin\.woff2\) format\('woff2'\);/);
    assert.doesNotMatch(out, /\.woff\)/);
  });

  it("没写 unicode-range 的保留", () => {
    const plain = "@font-face { font-family: X; src: url(x.woff2) format('woff2'); }";
    assert.equal(pruneFontFaces(plain, codePoints(["A"])), plain);
  });

  it("一个字都用不上时全部去掉", () => {
    assert.doesNotMatch(pruneFontFaces(face("cjk-2", "U+9000-9010"), codePoints(["A"])), /@font-face/);
  });
});

describe("codePoints", () => {
  it("按码位收集，四字节的字算一个", () => {
    assert.deepEqual([...codePoints(["a😀", "a"])], [0x61, 0x1f600]);
  });
});
