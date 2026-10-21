/**
 * 预渲染时按语言改页面的 <head>（scripts/prerender.ts 用）：lang、标题、描述、og 信息、各语言版本的链接；
 * 中文首页再加一段按语言自动跳转的小脚本；en/、ja/ 两页在下一级目录，资源的相对地址多退一级。测试见 head.test.ts。
 */

import { AUTO_REDIRECT_KEY, LANG_META, LANGS, STORED_LANG_KEY, type Lang } from "../src/i18n/langs.ts";

export type HeadInput = {
  lang: Lang;
  title: string;
  description: string;
  /** 站点的绝对地址（以 / 结尾），比如 https://example.github.io/BetterTavern/。给了才写 canonical 和 hreflang（它们要绝对地址） */
  siteUrl?: string;
};

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 把 template 里匹配 pattern 的那一处换掉；找不到就报错（index.html 改了而这里没跟上） */
function swap(html: string, pattern: RegExp, replacement: string | ((match: string) => string)): string {
  if (!pattern.test(html)) throw new Error(`index.html 里找不到 ${pattern}`);
  return html.replace(pattern, typeof replacement === "string" ? () => replacement : replacement);
}

/**
 * 首页按语言跳转：用户点过 English 或日本語时跳过去；没点过、也还没自动跳过时，按浏览器语言跳一次
 * （和 langFromBrowser 一样：中文留在这里，日文去 ja/，其他去 en/）。搜索引擎的爬虫不跳；浏览器不让存东西时也不跳。
 * 不开 JS 时不跳，页面本身就是完整的中文版。
 */
export function redirectScript(): string {
  const k = JSON.stringify(STORED_LANG_KEY);
  const a = JSON.stringify(AUTO_REDIRECT_KEY);
  return (
    `(function(){try{` +
    `if(/bot|crawl|spider|slurp|preview|facebookexternalhit/i.test(navigator.userAgent))return;` +
    `var s=localStorage.getItem(${k}),t=null;` +
    `if(s==="en"||s==="ja")t=s;` +
    `else if(!s&&!localStorage.getItem(${a})){localStorage.setItem(${a},"1");` +
    `var l=(navigator.language||"").toLowerCase().split("-")[0];if(l!=="zh")t=l==="ja"?"ja":"en";}` +
    `if(t)location.replace(t+"/"+location.search+location.hash);` +
    `}catch(e){}})();`
  );
}

export function localizeHead(template: string, input: HeadInput): string {
  const meta = LANG_META[input.lang];
  const title = escapeAttr(input.title);
  const description = escapeAttr(input.description);
  let html = template;
  html = swap(html, /<html lang="[^"]*">/, `<html lang="${meta.html}">`);
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
  const setMeta = (attr: "name" | "property", key: string, value: string) => {
    html = swap(html, new RegExp(`<meta ${attr}="${key}" content="[^"]*" />`), `<meta ${attr}="${key}" content="${value}" />`);
  };
  setMeta("name", "description", description);
  setMeta("property", "og:locale", meta.og);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);

  const extra: string[] = LANGS.filter((l) => l !== input.lang).map(
    (l) => `<meta property="og:locale:alternate" content="${LANG_META[l].og}" />`,
  );
  if (input.siteUrl) {
    const base = input.siteUrl.endsWith("/") ? input.siteUrl : `${input.siteUrl}/`;
    const url = (l: Lang) => escapeAttr(base + LANG_META[l].dir);
    extra.push(`<link rel="canonical" href="${url(input.lang)}" />`);
    extra.push(`<meta property="og:url" content="${url(input.lang)}" />`);
    for (const l of LANGS) {
      extra.push(`<link rel="alternate" hreflang="${LANG_META[l].html}" href="${url(l)}" />`);
    }
    // 没指定语言的访客先到中文首页，那里按浏览器语言跳
    extra.push(`<link rel="alternate" hreflang="x-default" href="${url("zh")}" />`);
  }
  html = swap(html, /\n\s*<\/head>/, `\n${extra.map((line) => `    ${line}`).join("\n")}\n  </head>`);

  if (input.lang === "zh") {
    // 放在最前面：在页面画出来之前就跳走
    const script = `<script>${redirectScript()}</script>`;
    html = swap(html, /<meta name="viewport"[^>]*\/>/, (m) => `${m}\n    ${script}`);
  }
  return html;
}

/** en/、ja/ 两页放在下一级目录：页面里 ./ 开头的资源地址改成 ../ */
export function rebase(html: string): string {
  return html.replace(/(\s(?:src|href)=")\.\//g, "$1../");
}
