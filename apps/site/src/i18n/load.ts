/** 浏览器里按语言加载那一份文案：三份各打成一个小块，页面只下载自己那一份 */

import type { Lang } from "./langs.ts";
import type { Copy } from "./types.ts";

const LOADERS: Record<Lang, () => Promise<Copy>> = {
  zh: () => import("./zh/index.ts").then((m) => m.zh),
  en: () => import("./en/index.ts").then((m) => m.en),
  ja: () => import("./ja/index.ts").then((m) => m.ja),
};

export function loadCopy(lang: Lang): Promise<Copy> {
  return LOADERS[lang]();
}
