/** 小部件：状态胶囊、编号（缩短 + 复制）、提示条、加载与出错、数字卡片、本地偏好 */

import { useState, type ReactNode } from "react";

import { HttpError } from "../api.ts";
import { shortId } from "../lib/format.ts";

export function Pill({ tone, children }: { tone?: "ok" | "warn" | "error" | "acc"; children: ReactNode }) {
  return <span className={`pill ${tone ?? ""}`}>{children}</span>;
}

export function statusTone(status: string | null | undefined): "ok" | "warn" | "error" | "acc" | undefined {
  if (status === "committed" || status === "replied" || status === "ok") return "ok";
  if (status === "failed" || status === "error") return "error";
  if (status === "generating" || status === "running") return "acc";
  if (status === "warn" || status === "archived") return "warn";
  return undefined;
}

export function httpTone(status: number | null | undefined, aborted = false): "ok" | "warn" | "error" {
  if (aborted || status === null || status === undefined) return "warn";
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "ok";
}

export function IdChip({ id, length = 8 }: { id: string | null | undefined; length?: number }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="mut">–</span>;
  const copy = (e: React.MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    void navigator.clipboard?.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <span className="idchip" title={id}>
      {shortId(id, length)}
      <button type="button" onClick={copy} aria-label={`复制 ${id}`}>
        {copied ? "已复制" : "复制"}
      </button>
    </span>
  );
}

export function Notice({ tone, children }: { tone?: "error" | "warn"; children: ReactNode }) {
  return <div className={`notice ${tone ?? ""}`}>{children}</div>;
}

export function Loading({ label = "加载中…" }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const hint =
    error instanceof HttpError && error.status === 503 ? "（只看日志的页面不受影响；检查 Postgres 是否在运行）" : "";
  return (
    <Notice tone="error">
      {message}
      {hint}
    </Notice>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "warn" | "error";
}) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone === "error" ? "err" : "warn"})` } : undefined}>
        {value}
      </div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 存在浏览器里的小偏好（显示故事内容、主题）；读写失败就用默认值 */
export function usePref(key: string, initial: string): [string, (value: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = (next: string): void => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // 浏览器不让存就算了
    }
  };
  return [value, set];
}
