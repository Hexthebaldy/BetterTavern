/**
 * 浏览器入口：按地址看是哪种语言（/、en/、ja/），加载那一份文案。
 * 构建出的页面里已经有预渲染的 HTML，在上面接上交互；开发服务器上页面是空的，直接渲染。
 */

import "./fonts.ts";
import "./styles/landing.css";
import "./styles/arc.css";
import "./styles/lang.css";

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { LangProvider } from "./i18n/context.tsx";
import { LANG_META, langFromPath } from "./i18n/langs.ts";
import { loadCopy } from "./i18n/load.ts";

const root = document.getElementById("root");
const lang = langFromPath(window.location.pathname);

void loadCopy(lang).then((copy) => {
  if (!root) return;
  const app = (
    <StrictMode>
      <LangProvider lang={lang} copy={copy}>
        <App />
      </LangProvider>
    </StrictMode>
  );
  if (root.hasChildNodes()) {
    hydrateRoot(root, app);
  } else {
    // 开发服务器上 /en/、/ja/ 用的也是中文的 index.html：语言和标题在这里补上（构建出的页面在预渲染时就写好了）
    document.documentElement.lang = LANG_META[lang].html;
    document.title = copy.meta.title;
    createRoot(root).render(app);
  }
});
