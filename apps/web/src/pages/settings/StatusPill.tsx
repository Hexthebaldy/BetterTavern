/** 模型的状态：可用 / 还没测试 / Key 无效，颜色一定配图标（对勾、虚线圆、叉） */

import { Pill } from "../../components/controls.tsx";

export function StatusPill({ kind, label }: { kind: "ok" | "untested" | "invalid"; label: string }) {
  const tone = kind === "ok" ? "ok" : kind === "untested" ? "warn" : "err";
  const icon = kind === "ok" ? "check" : kind === "untested" ? "untested" : "cross";
  return <Pill label={label} tone={tone} icon={icon} />;
}
