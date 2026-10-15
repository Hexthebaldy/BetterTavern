/**
 * App 启动时装好诊断日志：开发时同时打到 Metro 终端，从文件里接回上次的记录，记一条 app.started，
 * 并接住没人处理的异常（记一条 app.error 再交给原来的处理方式，红屏 / 崩溃照旧）。只装一次。
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

import { CLIENT_VERSION } from "../config.ts";
import { diagnostics, type LogEntry } from "./log.ts";
import { flushDiagnostics, startDiagnosticsPersistence } from "./persist.ts";

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): GlobalHandler; setGlobalHandler(handler: GlobalHandler): void };

// 记在日志实例上而不是模块变量里：开发时热更新会重新执行这个模块，模块变量会被重置
const INSTALLED = Symbol.for("bettertavern.diagnostics.installed");

function consoleLine(entry: LogEntry): string {
  const { ts, level, event, ...fields } = entry;
  const rest = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return `[${ts.slice(11, 23)}] ${level.toUpperCase().padEnd(5)} ${event} ${rest}`;
}

export function platformLabel(): string {
  return `${Platform.OS} ${String(Platform.Version)}`;
}

export function installDiagnostics(): void {
  const marked = diagnostics as unknown as Record<symbol, boolean>;
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    diagnostics.setConsole((entry) => console.log(consoleLine(entry)));
  }
  void startDiagnosticsPersistence().then(() => {
    diagnostics.info("app.started", {
      version: CLIENT_VERSION,
      platform: platformLabel(),
      runtime: Constants.executionEnvironment,
    });
  });
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      diagnostics.error("app.error", {
        fatal: isFatal === true,
        error: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : undefined,
      });
      if (isFatal) flushDiagnostics();
      previous(error, isFatal);
    });
  }
}
