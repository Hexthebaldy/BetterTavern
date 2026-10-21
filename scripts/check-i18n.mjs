/**
 * 界面文字都要走 i18n（docs/i18n.md 第 5 节）：手机端、网页端、packages/core 和落地页的代码里不能出现含汉字或假名的
 * 字符串、模板字符串和 JSX 文字。注释不算；资源目录（packages/core/src/i18n/、落地页的 apps/site/src/i18n/）、
 * 测试文件和测试夹具不查。
 * 用法：node scripts/check-i18n.mjs（make lint 里会跑）。发现问题时列出位置，退出码 1。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["apps/mobile/app", "apps/mobile/src", "apps/web/src", "apps/site/src", "packages/core/src", "packages/design/src"];
const SKIP = [
  /^packages\/core\/src\/i18n\//,
  /^apps\/site\/src\/i18n\//,
  /\.test\.tsx?$/,
  /\.d\.ts$/,
  /^packages\/core\/src\/play\/testing\.ts$/,
];
// 汉字，加上日文的平假名和片假名（写死的日文往往只有假名）
const HAN = /[぀-ヿ㐀-䶿一-鿿]/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

const problems = [];
for (const dir of DIRS) {
  for (const file of walk(path.join(root, dir))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (SKIP.some((re) => re.test(rel))) continue;
    const text = fs.readFileSync(file, "utf8");
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (node) => {
      const literal =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node);
      if (literal && HAN.test(node.text)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        problems.push(`${rel}:${line + 1}  ${node.text.trim().slice(0, 60)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

if (problems.length > 0) {
  console.error("这些界面文字没有走 i18n（App 的放进 packages/core/src/i18n/ 的资源，用 t() 取；落地页的放进 apps/site/src/i18n/ 的文案，用 useCopy() 取）：");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("i18n: 界面代码里没有写死的中文或日文");
