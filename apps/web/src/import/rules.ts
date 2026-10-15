/**
 * 导入角色卡的规则（同 App 的 app/(tabs)/library.tsx）：只收 .png 和 .json，最大 16 MB；
 * 一次拖进多张时逐个导入，最后汇总成一句浮条，失败的另外列出。
 */

export const MAX_CARD_BYTES = 16 * 1024 * 1024;

/** 文件选择框的 accept */
export const CARD_ACCEPT = ".png,.json,image/png,application/json";

export type CardProblem = { title: string; message: string };

/** 不能导入时给出原因（和 App 的红色提示条同一套文案）；能导入返回 null */
export function checkCardFile(file: { name: string; size: number }): CardProblem | null {
  if (!/\.(png|json)$/i.test(file.name)) {
    return { title: `${file.name} 不是角色卡`, message: "只支持 PNG 或 JSON，最大 16 MB。" };
  }
  if (file.size > MAX_CARD_BYTES) return { title: `${file.name} 太大了`, message: "角色卡最大 16 MB。" };
  return null;
}

export type ImportOutcome =
  | { kind: "imported"; id: string; name: string }
  | { kind: "duplicate"; id: string; name: string }
  | { kind: "failed"; problem: CardProblem };

/** 多张一起导入后的浮条：导入了几张、几张之前导入过；一张都没成功时没有浮条（只有红色提示） */
export function importSummary(outcomes: readonly ImportOutcome[]): string | null {
  const imported = outcomes.filter((o) => o.kind === "imported").length;
  const duplicate = outcomes.filter((o) => o.kind === "duplicate").length;
  if (imported === 0 && duplicate === 0) return null;
  const parts: string[] = [];
  if (imported > 0) parts.push(`导入了 ${imported} 张角色卡`);
  if (duplicate > 0) parts.push(`${duplicate} 张之前已经导入过`);
  return parts.join("，");
}

/** 失败的那些合成一条红色提示；一张时就是那一张的原因 */
export function failureNotice(outcomes: readonly ImportOutcome[]): CardProblem | null {
  const failed = outcomes.flatMap((o) => (o.kind === "failed" ? [o.problem] : []));
  const [first] = failed;
  if (!first) return null;
  if (failed.length === 1) return first;
  return { title: `有 ${failed.length} 张没有导入`, message: failed.map((p) => p.title).join("；") };
}
