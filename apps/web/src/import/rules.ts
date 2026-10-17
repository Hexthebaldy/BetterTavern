/**
 * 导入角色卡的规则（同 App 的 app/(tabs)/library.tsx）：只收 .png 和 .json，最大 16 MB；
 * 一次拖进多张时逐个导入，最后汇总成一句浮条，失败的另外列出。
 */

import { i18n } from "@bettertavern/core/i18n/index";

export const MAX_CARD_BYTES = 16 * 1024 * 1024;

/** 文件选择框的 accept */
export const CARD_ACCEPT = ".png,.json,image/png,application/json";

export type CardProblem = { title: string; message: string };

/** 不能导入时给出原因（和 App 的红色提示条同一套文案）；能导入返回 null */
export function checkCardFile(file: { name: string; size: number }): CardProblem | null {
  if (!/\.(png|json)$/i.test(file.name)) {
    return {
      title: i18n.t("library.notCard", { name: file.name }),
      message: i18n.t("library.notCardMessage"),
    };
  }
  if (file.size > MAX_CARD_BYTES)
    return {
      title: i18n.t("library.tooLarge", { name: file.name }),
      message: i18n.t("library.tooLargeMessage"),
    };
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
  if (imported > 0) parts.push(i18n.t("import.imported", { count: imported }));
  if (duplicate > 0) parts.push(i18n.t("import.duplicates", { count: duplicate }));
  return parts.join(i18n.t("common.comma"));
}

/** 失败的那些合成一条红色提示；一张时就是那一张的原因 */
export function failureNotice(outcomes: readonly ImportOutcome[]): CardProblem | null {
  const failed = outcomes.flatMap((o) => (o.kind === "failed" ? [o.problem] : []));
  const [first] = failed;
  if (!first) return null;
  if (failed.length === 1) return first;
  return {
    title: i18n.t("import.failed", { count: failed.length }),
    message: failed.map((p) => p.title).join(i18n.t("common.clauseSeparator")),
  };
}
