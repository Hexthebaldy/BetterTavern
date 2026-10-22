/**
 * 导入角色卡的规则（同 App 的工作台首页）：只收 .png 和 .json，最大 16 MB，一次一张。
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
      title: i18n.t("workbench.import.notCard", { name: file.name }),
      message: i18n.t("workbench.import.notCardMessage"),
    };
  }
  if (file.size > MAX_CARD_BYTES)
    return {
      title: i18n.t("workbench.import.tooLarge", { name: file.name }),
      message: i18n.t("workbench.import.tooLargeMessage"),
    };
  return null;
}
