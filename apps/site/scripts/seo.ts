/**
 * 给搜索引擎的几个文件（scripts/prerender.ts 构建时写进 dist）：robots.txt、sitemap.xml、404.html。测试见 seo.test.ts。
 * 站点地图里的地址必须是完整地址，所以和 canonical 一样，只在构建时给了 SITE_URL 才生成。
 */

import { LANG_META, LANGS, type Lang } from "../src/i18n/langs.ts";
import type { Copy } from "../src/i18n/types.ts";

/** 站点地址统一成以 / 结尾 */
export function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * robots.txt：页面都可以抓；安装包目录不让抓（110 MB，抓了也没用）。给了站点地址时写上站点地图的位置。
 */
export function robotsTxt(siteUrl?: string): string {
  const lines = ["User-agent: *", "Allow: /", "Disallow: /downloads/"];
  if (siteUrl) lines.push("", `Sitemap: ${normalizeSiteUrl(siteUrl)}sitemap.xml`);
  return `${lines.join("\n")}\n`;
}

/**
 * sitemap.xml：三种语言的首页各一条，每条都列出另外几种语言的版本（和页面里的 hreflang 一样），
 * 没指定语言的访客先到中文首页（x-default）。不写 lastmod：构建时间不等于内容改动的时间，写了反而误导。
 */
export function sitemapXml(siteUrl: string): string {
  const base = normalizeSiteUrl(siteUrl);
  const url = (l: Lang) => escapeXml(base + LANG_META[l].dir);
  const alternates = [
    ...LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${LANG_META[l].html}" href="${url(l)}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${url("zh")}"/>`,
  ].join("\n");
  const entries = LANGS.map((l) => `  <url>\n    <loc>${url(l)}</loc>\n${alternates}\n  </url>`).join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${entries}\n</urlset>\n`
  );
}

/**
 * 404.html：服务器找不到地址时返回它（状态码是 404）。不知道访客用什么语言，三种语言都写上，各自链回自己的首页。
 * 不依赖站点的样式表和脚本（文件名带哈希，404 页出现在任意路径下），样式写在页面里；不让搜索引擎收录。
 * 链接用绝对路径：给了站点地址就用完整地址，没给就从根目录算。
 */
export function notFoundHtml(
  copies: Record<Lang, Copy>,
  opts: { siteUrl?: string; iconHref?: string } = {},
): string {
  const base = opts.siteUrl ? normalizeSiteUrl(opts.siteUrl) : "/";
  const blocks = LANGS.map((l) => {
    const c = copies[l].notFound;
    return (
      `      <section lang="${LANG_META[l].html}">\n` +
      `        <h2>${escapeXml(c.title)}</h2>\n` +
      `        <p>${escapeXml(c.text)}</p>\n` +
      `        <a href="${escapeXml(base + LANG_META[l].dir)}">${escapeXml(c.home)} →</a>\n` +
      `      </section>`
    );
  }).join("\n");
  const icon = opts.iconHref ? `\n    <link rel="icon" href="${escapeXml(opts.iconHref)}" type="image/svg+xml" />` : "";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>404 · BetterTavern</title>${icon}
    <style>
      body{margin:0;background:#FFFFFF;color:#1A1A1A;font-family:system-ui,-apple-system,"PingFang SC","Hiragino Sans",sans-serif;line-height:1.7}
      main{max-width:560px;margin:0 auto;padding:clamp(48px,10vw,120px) 20px 64px}
      h1{margin:0 0 32px;font-family:Georgia,"Songti SC",serif;font-size:72px;line-height:1;color:#1A1A1A;text-shadow:4px 4px 0 #2F55F4}
      section{padding:20px 0;border-top:2.5px solid #1A1A1A}
      h2{margin:0 0 4px;font-size:20px}
      p{margin:0 0 8px;color:#3D3C38}
      a{color:#2F55F4;font-weight:700;text-decoration:none}
      a:hover{text-decoration:underline}
    </style>
  </head>
  <body>
    <main>
      <h1>404</h1>
${blocks}
    </main>
  </body>
</html>
`;
}
