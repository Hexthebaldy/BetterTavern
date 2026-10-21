/** 构建时在 Node 里用（scripts/prerender.ts）：把一种语言的整页渲染成 HTML 字符串，文案也从这里交给预渲染脚本 */

import { StrictMode } from "react";
import { prerender } from "react-dom/static";

import { App } from "./App.tsx";
import { COPIES } from "./i18n/all.ts";
import { LangProvider } from "./i18n/context.tsx";
import type { Lang } from "./i18n/langs.ts";

export { COPIES };

export async function render(lang: Lang): Promise<string> {
  const { prelude } = await prerender(
    <StrictMode>
      <LangProvider lang={lang} copy={COPIES[lang]}>
        <App />
      </LangProvider>
    </StrictMode>,
  );
  return new Response(prelude).text();
}
