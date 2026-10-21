/** 构建时在 Node 里用（scripts/prerender.ts）：把整页渲染成 HTML 字符串 */

import { StrictMode } from "react";
import { prerender } from "react-dom/static";

import { App } from "./App.tsx";

export async function render(): Promise<string> {
  const { prelude } = await prerender(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return new Response(prelude).text();
}
