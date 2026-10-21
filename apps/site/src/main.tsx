/** 浏览器入口：构建出的页面里已经有预渲染的 HTML，在上面接上交互；开发服务器上页面是空的，直接渲染 */

import "./styles/landing.css";

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { App } from "./App.tsx";

const root = document.getElementById("root");
if (root) {
  const app = (
    <StrictMode>
      <App />
    </StrictMode>
  );
  if (root.hasChildNodes()) hydrateRoot(root, app);
  else createRoot(root).render(app);
}
