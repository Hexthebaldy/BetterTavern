/** 文案里的两种记号：{name} 这类占位，和一对反引号括起来的行内代码。测试见 format.test.ts */

/** 把 {key} 换成 vars 里的值；没给的占位原样留着 */
export function fill(text: string, vars: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

export type RichPart = { code: boolean; text: string };

/** 按反引号切开：单数段是普通文字，双数段是行内代码；空的段去掉 */
export function richParts(text: string): RichPart[] {
  return text
    .split("`")
    .map((part, i) => ({ code: i % 2 === 1, text: part }))
    .filter((p) => p.text !== "");
}
