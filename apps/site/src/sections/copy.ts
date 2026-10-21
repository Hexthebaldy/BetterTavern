/**
 * 复制部署命令：先用剪贴板接口；不可用或被拒绝时，选中命令再试一次旧的复制命令；还不行就保留选中，
 * 提示用户自己按 ⌘C 或 Ctrl+C。测试见 copy.test.ts。
 */

export type CopyResult = "ok" | "sel";

export type CopyEnv = {
  /** navigator.clipboard.writeText；没有剪贴板接口（比如不是 https）时不传 */
  writeText?: (text: string) => Promise<void>;
  /** 选中命令，用 document.execCommand("copy") 复制，返回是否成功；失败时保留选中 */
  selectAndCopy: () => boolean;
};

export async function copyCommands(text: string, env: CopyEnv): Promise<CopyResult> {
  const fallback = (): CopyResult => {
    try {
      return env.selectAndCopy() ? "ok" : "sel";
    } catch {
      return "sel";
    }
  };
  if (!env.writeText) return fallback();
  try {
    await env.writeText(text);
    return "ok";
  } catch {
    return fallback();
  }
}

/** 提示停留多久恢复成“复制”（毫秒）：选中的提示要读一会儿 */
export const COPY_RESET_MS: Record<CopyResult, number> = { ok: 2200, sel: 4000 };

/** 苹果的设备上提示 ⌘C，其他提示 Ctrl+C */
export function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

/** 复制按钮上显示哪一句（文字在文案的 copy.deploy 里）：复制 / 已复制 / 已选中，按 ⌘C 或 Ctrl+C 复制 */
export type CopyLabel = "copy" | "copied" | "selectedMac" | "selectedOther";

export function copyLabel(result: CopyResult | null, apple: boolean): CopyLabel {
  if (result === "ok") return "copied";
  if (result === "sel") return apple ? "selectedMac" : "selectedOther";
  return "copy";
}
