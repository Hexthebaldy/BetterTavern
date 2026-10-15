/**
 * 网页启动时装好诊断日志：从浏览器里接回上次的记录（localStorage 的 bt.diagnostics，最多 500 条），
 * 记一条 app.started，接住没人处理的异常（记一条 app.error）。写入合并成最多一秒一次，关页面前再写一次。
 * 记录不含故事内容和密钥（core 的 DiagnosticsLog 负责脱敏），只存在这个浏览器里。
 */

import { diagnostics } from "@bettertavern/core/observability/log";

import { CLIENT_VERSION } from "../config.ts";
import { localStore } from "../storage/local.ts";

const KEY = "bt.diagnostics";

export function platformLabel(): string {
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return `web · ${data?.platform || navigator.platform || "browser"}`;
}

export function installDiagnostics(): void {
  const saved = localStore.read(KEY);
  if (Array.isArray(saved)) diagnostics.restore(saved);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    localStore.write(KEY, diagnostics.all());
  };
  diagnostics.subscribe(() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(write, 1000);
  });
  window.addEventListener("pagehide", write);
  diagnostics.info("app.started", { version: CLIENT_VERSION, platform: platformLabel() });
  const report = (error: unknown): void =>
    diagnostics.error("app.error", {
      error: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : undefined,
    });
  window.addEventListener("error", (event) => report(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => report(event.reason));
}
