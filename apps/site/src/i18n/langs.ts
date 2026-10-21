/**
 * 落地页的三种语言：中文是 /，英文是 /en/，日文是 /ja/，构建时各预渲染一份（scripts/prerender.ts）。
 * 这里是纯数据和纯函数，测试见 langs.test.ts。
 */

export const LANGS = ["zh", "en", "ja"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_META: Record<Lang, { html: string; og: string; dir: string; label: string }> = {
  zh: { html: "zh-CN", og: "zh_CN", dir: "", label: "中文" },
  en: { html: "en", og: "en_US", dir: "en/", label: "English" },
  ja: { html: "ja", og: "ja_JP", dir: "ja/", label: "日本語" },
};

/**
 * 用户在页面上点过的语言存在浏览器里的这个键；以后打开中文首页时按它跳（scripts/head.ts 的 redirectScript）。
 * 没点过时，第一次打开中文首页按浏览器语言跳一次，跳过以后记下 AUTO_REDIRECT_KEY，不再自动跳。
 */
export const STORED_LANG_KEY = "bettertavern.site.lang";
export const AUTO_REDIRECT_KEY = "bettertavern.site.redirected";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** 从页面地址看是哪种语言：路径以 /en/ 或 /ja/ 结尾（可以带 index.html）；其余都是中文 */
export function langFromPath(pathname: string): Lang {
  const m = /\/(en|ja)\/(?:index\.html)?$/.exec(pathname);
  return m ? (m[1] as Lang) : "zh";
}

/** 从 <html lang> 看是哪种语言 */
export function langFromHtml(htmlLang: string): Lang | null {
  return LANGS.find((l) => LANG_META[l].html === htmlLang) ?? null;
}

/**
 * 按浏览器语言选：和 App 的“跟随系统”一样，系统语言是中文时用中文，是日文时用日文，其他用英文。
 * 只看第一个语言（navigator.language）。
 */
export function langFromBrowser(language: string | undefined): Lang {
  const primary = (language ?? "").toLowerCase().split("-")[0];
  if (primary === "zh") return "zh";
  if (primary === "ja") return "ja";
  return "en";
}

/** 从一种语言的页面链到另一种：页面都是相对地址，放在子路径下也能用（比如 GitHub Pages 的 /BetterTavern/） */
export function langHref(from: Lang, to: Lang): string {
  const up = from === "zh" ? "./" : "../";
  return up + LANG_META[to].dir;
}
