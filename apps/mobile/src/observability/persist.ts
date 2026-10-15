/**
 * 把诊断日志存到手机上的一个文件里（App 的文档目录，diagnostics.jsonl，每行一条），App 重启后接着用。
 * 写入合并成最多一秒一次；读写失败不影响 App，只是这次少存了几条。
 */

import { File, Paths } from "expo-file-system";

import { diagnostics, type DiagnosticsLog } from "./log.ts";

const FILE_NAME = "diagnostics.jsonl";

let writeNow: (() => void) | null = null;

/** 立刻写一次（App 要崩溃时用，等不到合并写入的那一秒） */
export function flushDiagnostics(): void {
  writeNow?.();
}

export async function startDiagnosticsPersistence(log: DiagnosticsLog = diagnostics): Promise<() => void> {
  const file = new File(Paths.document, FILE_NAME);
  try {
    if (file.exists) {
      const lines = (await file.text()).split("\n").filter((line) => line.trim() !== "");
      const saved: unknown[] = [];
      for (const line of lines) {
        try {
          saved.push(JSON.parse(line));
        } catch {
          // 坏行跳过
        }
      }
      log.restore(saved);
    }
  } catch {
    // 读不出来就从空的开始
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    try {
      if (!file.exists) file.create();
      file.write(
        log
          .all()
          .map((e) => JSON.stringify(e))
          .join("\n"),
      );
    } catch {
      // 写不进去就算了
    }
  };
  writeNow = write;
  const unsubscribe = log.subscribe(() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(write, 1000);
  });
  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
    if (writeNow === write) writeNow = null;
  };
}
