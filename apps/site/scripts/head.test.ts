import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { AUTO_REDIRECT_KEY, STORED_LANG_KEY } from "../src/i18n/langs.ts";
import { localizeHead, rebase, redirectScript, softwareJsonLd } from "./head.ts";

const template = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("localizeHead", () => {
  it("英文页：lang、标题、描述、og 都换掉，列出另外两种语言", () => {
    const html = localizeHead(template, { lang: "en", title: "BT · Fiction", description: 'Say "hi" & <go>' });
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>BT · Fiction<\/title>/);
    assert.match(html, /<meta name="description" content="Say &quot;hi&quot; &amp; &lt;go&gt;" \/>/);
    assert.match(html, /<meta property="og:locale" content="en_US" \/>/);
    assert.match(html, /og:locale:alternate" content="zh_CN"/);
    assert.match(html, /og:locale:alternate" content="ja_JP"/);
    assert.doesNotMatch(html, /og:locale:alternate" content="en_US"/);
    // 不给站点地址就不写要完整地址的东西：canonical、hreflang、分享配图、结构化数据；只有中文页有跳转脚本
    assert.doesNotMatch(html, /hreflang|canonical|og:image|ld\+json/);
    assert.match(html, /<meta name="twitter:card" content="summary" \/>/);
    assert.doesNotMatch(html, /<script>/);
  });

  it("给了站点地址：canonical 和三种语言加 x-default 的 hreflang", () => {
    const html = localizeHead(template, { lang: "ja", title: "t", description: "d", siteUrl: "https://example.com/BT" });
    assert.match(html, /<link rel="canonical" href="https:\/\/example.com\/BT\/ja\/" \/>/);
    assert.match(html, /hreflang="zh-CN" href="https:\/\/example.com\/BT\/"/);
    assert.match(html, /hreflang="en" href="https:\/\/example.com\/BT\/en\/"/);
    assert.match(html, /hreflang="x-default" href="https:\/\/example.com\/BT\/"/);
  });

  it("给了站点地址：这种语言的分享配图（大图卡片）和结构化数据", () => {
    const site = "https://example.com/";
    const html = localizeHead(template, { lang: "en", title: "BT", description: "d", siteUrl: site });
    assert.match(html, /<meta property="og:image" content="https:\/\/example\.com\/og\/en\.png" \/>/);
    assert.match(html, /<meta property="og:image:width" content="1200" \/>/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
    const json = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)?.[1];
    const data = JSON.parse(json!);
    assert.equal(data["@type"], "SoftwareApplication");
    assert.equal(data.url, "https://example.com/en/");
    assert.equal(data.inLanguage, "en");
    assert.equal(data.downloadUrl, "https://example.com/downloads/BetterTavern.apk");
  });

  it("中文页在 <head> 最前面放跳转脚本", () => {
    const html = localizeHead(template, { lang: "zh", title: "t", description: "d" });
    const script = html.indexOf("<script>");
    assert.ok(script > 0 && script < html.indexOf("<title>"));
  });
});

describe("softwareJsonLd", () => {
  it("文字里的 < 转义掉，不会提前结束 <script>", () => {
    const json = softwareJsonLd({
      lang: "zh",
      description: "a</script><b>",
      pageUrl: "https://e/",
      siteUrl: "https://e/",
      image: "https://e/og/zh.png",
    });
    assert.doesNotMatch(json, /</);
    assert.equal(JSON.parse(json).description, "a</script><b>");
  });
});

describe("rebase", () => {
  it("./ 开头的资源地址退一级，其他地址不动", () => {
    const html = '<link rel="icon" href="./assets/f.svg" /><script type="module" crossorigin src="./assets/i.js"></script><a href="https://x/">x</a>';
    assert.equal(
      rebase(html),
      '<link rel="icon" href="../assets/f.svg" /><script type="module" crossorigin src="../assets/i.js"></script><a href="https://x/">x</a>',
    );
  });
});

/** 在假的浏览器环境里跑一遍跳转脚本，返回跳去了哪里（没跳是 null）和之后存了什么 */
function runRedirect(env: { language?: string; ua?: string; stored?: Record<string, string>; hash?: string; storageFails?: boolean }) {
  const store = new Map(Object.entries(env.stored ?? {}));
  let target: string | null = null;
  const localStorage = {
    getItem: (k: string) => {
      if (env.storageFails) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const location = { search: "", hash: env.hash ?? "", replace: (url: string) => void (target = url) };
  const navigator = { language: env.language ?? "zh-CN", userAgent: env.ua ?? "Mozilla/5.0" };
  new Function("navigator", "localStorage", "location", redirectScript())(navigator, localStorage, location);
  return { target, store: Object.fromEntries(store) };
}

describe("redirectScript", () => {
  it("第一次来：浏览器是英文去 en/，日文去 ja/，中文不跳；之后不再自动跳", () => {
    assert.equal(runRedirect({ language: "en-US", hash: "#faq" }).target, "en/#faq");
    assert.equal(runRedirect({ language: "ja-JP" }).target, "ja/");
    assert.equal(runRedirect({ language: "fr" }).target, "en/");
    assert.equal(runRedirect({ language: "zh-TW" }).target, null);
    const first = runRedirect({ language: "en-US" });
    assert.equal(first.store[AUTO_REDIRECT_KEY], "1");
    assert.equal(runRedirect({ language: "en-US", stored: first.store }).target, null);
  });

  it("点过语言就按点的跳；点过中文就留在这里", () => {
    assert.equal(runRedirect({ language: "zh-CN", stored: { [STORED_LANG_KEY]: "ja" } }).target, "ja/");
    assert.equal(runRedirect({ language: "en-US", stored: { [STORED_LANG_KEY]: "zh" } }).target, null);
  });

  it("爬虫不跳；浏览器不让存东西时也不跳", () => {
    assert.equal(runRedirect({ language: "en-US", ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" }).target, null);
    assert.equal(runRedirect({ language: "en-US", storageFails: true }).target, null);
  });
});
