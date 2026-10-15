// 开发时：npm run dev 起 Vite（5173），/api 转给 bettertavern vis（8100）。
// 构建后：npm run build 生成 dist，由 bettertavern vis 直接提供，打开 http://127.0.0.1:8100
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8100" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
