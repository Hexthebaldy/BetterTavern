/**
 * 开发和预览服务器把接口转给后端（默认 http://localhost:8000，BT_API_URL 可以改），网页和接口同源，
 * 不用配跨域，Cookie 登录也能用。生产环境由反向代理做同样的事（deploy/nginx.example.conf）。
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.BT_API_URL ?? "http://localhost:8000";
const proxy = { "/v1": api, "/health": api, "/ready": api };

// 和线上 nginx 的 Content-Security-Policy 一致（deploy/nginx.bettertavern.conf）：npm run preview 时带上，
// 构建出来的网页在本机就能发现违反 CSP 的地方。开发服务器不带（热更新要内联脚本）
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
  "frame-ancestors 'none'";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy, headers: { "Content-Security-Policy": csp } },
});
