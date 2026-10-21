/**
 * 托管字体（@fontsource）的 CSS 按 unicode-range 切成很多片，每片一条 @font-face，浏览器只下载页面上用到的片。
 * 思源宋体每个字重 101 片，三个字重的 @font-face 合起来近 300 KB（gzip 后约 94 KB），还挡着首屏渲染。
 * 落地页上的字都写在源码里，所以构建时去掉一个字都用不上的片：浏览器本来也不会下载它们，下载哪些片不变，
 * 只是样式表小了，dist 里也不带那些字体文件。另外去掉 woff 的备用地址（支持 woff2 的浏览器用不到）。
 * 三种语言共用一份样式表，每个字体包只看用到它的那几种语言的文案（vite.config.ts）。
 * 测试见 fontFaces.test.ts。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

/** "U+0-ff,U+4e00,U+1f1e9-1f1f5,U+4??" → [[0, 255], [19968, 19968], …]；问号是通配的十六进制位 */
export function parseUnicodeRange(value: string): [number, number][] {
  return value
    .split(",")
    .map((part) => part.trim().replace(/^U\+/i, ""))
    .filter(Boolean)
    .map((part): [number, number] => {
      if (part.includes("?")) return [parseInt(part.replace(/\?/g, "0"), 16), parseInt(part.replace(/\?/g, "f"), 16)];
      const [lo = "", hi = lo] = part.split("-");
      return [parseInt(lo, 16), parseInt(hi, 16)];
    });
}

/** 文字里出现的所有字符（按码位） */
export function codePoints(texts: Iterable<string>): Set<number> {
  const out = new Set<number>();
  for (const text of texts) for (const ch of text) out.add(ch.codePointAt(0)!);
  return out;
}

/** 有没有哪个字落在这些区间里。sorted 是从小到大排好的码位 */
function covers(ranges: [number, number][], sorted: readonly number[]): boolean {
  return ranges.some(([lo, hi]) => {
    // 第一个不小于 lo 的码位
    let a = 0;
    let b = sorted.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (sorted[mid]! < lo) a = mid + 1;
      else b = mid;
    }
    return a < sorted.length && sorted[a]! <= hi;
  });
}

const FACE = /(?:\/\*[^*]*\*\/\s*)?@font-face\s*\{[^}]*\}\s*/g;
const WOFF = /,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g;

/** 去掉用不上的 @font-face（连同它前面那行注释）和 woff 备用地址；没写 unicode-range 的保留 */
export function pruneFontFaces(css: string, used: ReadonlySet<number>): string {
  const sorted = [...used].sort((x, y) => x - y);
  return css.replace(FACE, (block) => {
    const range = /unicode-range:\s*([^;}]+)/.exec(block);
    if (range && !covers(parseUnicodeRange(range[1]!), sorted)) return "";
    return block.replace(WOFF, "");
  });
}

function* walk(dir: string, skip: readonly string[]): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip.includes(full)) continue;
    if (entry.isDirectory()) yield* walk(full, skip);
    else if (/\.(tsx?|css|html)$/.test(entry.name)) yield full;
  }
}

/** 一组字从哪些文件里取：include 里的文件和目录（目录递归），跳过 skip 里的 */
export type SourceSet = { include: readonly string[]; skip?: readonly string[] };

/** 每个 @fontsource 包（按包名，比如 "noto-serif-jp"）的字从哪里取；没列出的包用 default */
export type SubsetSources = { default: SourceSet } & Record<string, SourceSet>;

/** @fontsource 样式表的地址里的包名：…/@fontsource/noto-serif-sc/700.css → noto-serif-sc；不是这种样式表时是 null */
export function fontsourcePackage(id: string): string | null {
  return /[\\/]@fontsource[\\/]([^\\/]+)[\\/]\d+\.css(\?|$)/.exec(id)?.[1] ?? null;
}

/**
 * Vite 插件：处理 @fontsource 的样式表。每个包用得上的字取自它那一组文件，再加上全部可打印的 ASCII。
 * 开发服务器上只在第一次用到时读一遍，改了文案要重启 make site 才会补上新字的片。
 */
export function fontSubsets(sources: SubsetSources): Plugin {
  const used = new Map<string, Set<number>>();
  const collect = (set: SourceSet) => {
    const skip = set.skip ?? [];
    const files = set.include.flatMap((p) => (p.endsWith(".html") ? [p] : [...walk(p, skip)]));
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
    return codePoints([ascii, ...files.map((f) => readFileSync(f, "utf8"))]);
  };
  return {
    name: "bettertavern-font-subsets",
    enforce: "pre",
    transform(code, id) {
      const pkg = fontsourcePackage(id);
      if (!pkg) return null;
      const key = pkg in sources ? pkg : "default";
      let chars = used.get(key);
      if (!chars) {
        chars = collect(sources[key]!);
        used.set(key, chars);
      }
      return { code: pruneFontFaces(code, chars), map: null };
    },
  };
}
