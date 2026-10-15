/**
 * 原始日志：所有记录按时间一行一条，按级别、来源、编号、关键字筛选；打开“实时”时新记录自动追加并滚到底。
 * 点一行在右边看全部字段。可以把手机导出的诊断日志拖进来，和服务端的记录按时间合在一起看。
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getJson, type LogEntry, type LogPage } from "../api.ts";
import { ErrorBox, Pill } from "../components/common.tsx";
import { EntryFields } from "../components/EntryRow.tsx";
import { describeEntry, entryInfo } from "../lib/catalog.ts";
import { clockMs } from "../lib/format.ts";
import { mergeByTime } from "../lib/phone.ts";
import { usePhone } from "../phoneContext.tsx";

const LEVELS = [
  { value: "debug", label: "全部级别" },
  { value: "info", label: "info 及以上" },
  { value: "warning", label: "只看警告和错误" },
  { value: "error", label: "只看错误" },
];
const RANK: Record<string, number> = { debug: 0, info: 1, warning: 2, error: 3, critical: 4 };
const KEEP = 5000;

function levelTone(level: string): "warn" | "error" | undefined {
  if (level === "error" || level === "critical") return "error";
  if (level === "warning") return "warn";
  return undefined;
}

function matchesPhone(entry: LogEntry, level: string, q: string, id: string): boolean {
  if ((RANK[entry.level] ?? 1) < (RANK[level] ?? 0)) return false;
  if (id && !Object.values(entry).some((v) => typeof v === "string" && v.startsWith(id))) return false;
  if (q && !JSON.stringify(entry).toLowerCase().includes(q.toLowerCase())) return false;
  return true;
}

export function Logs() {
  const [params, setParams] = useSearchParams();
  const level = params.get("level") ?? "info";
  const q = params.get("q") ?? "";
  const id = params.get("id") ?? "";
  const file = params.get("file") ?? "";
  const [live, setLive] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [draftQ, setDraftQ] = useState(q);
  const [draftId, setDraftId] = useState(id);
  const cursor = useRef(0);
  const parent = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const { phone } = usePhone();

  const query = useMemo(() => {
    const p = new URLSearchParams({ level, q, id, file, limit: "2000" });
    return p.toString();
  }, [level, q, id, file]);

  useEffect(() => {
    let alive = true;
    setEntries([]);
    cursor.current = 0;
    void getJson<LogPage>(`/api/logs?${query}`)
      .then((page) => {
        if (!alive) return;
        setEntries(page.entries);
        setFiles(page.files);
        cursor.current = page.cursor;
        setError(null);
        atBottom.current = true;
      })
      .catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [query]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      void getJson<LogPage>(`/api/logs?${query}&after=${cursor.current}`)
        .then((page) => {
          cursor.current = page.cursor;
          if (page.entries.length > 0) setEntries((prev) => [...prev, ...page.entries].slice(-KEEP));
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [live, query]);

  const shown = useMemo(() => {
    if (!phone || (file && file !== "phone")) return entries;
    const phoneEntries = phone.entries.filter((e) => matchesPhone(e, level, q, id));
    return file === "phone" ? phoneEntries : mergeByTime(entries, phoneEntries);
  }, [entries, phone, level, q, id, file]);

  const virtual = useVirtualizer({
    count: shown.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 30,
    overscan: 30,
  });

  useEffect(() => {
    if (live && atBottom.current && shown.length > 0) virtual.scrollToIndex(shown.length - 1, { align: "end" });
  }, [shown.length, live, virtual]);

  const set = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="page-head">
        <h1>原始日志</h1>
        <span className="mut small">
          共 {shown.length} 条（最多显示最近 {KEEP} 条）
        </span>
      </div>
      <form
        className="logbar"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          for (const [k, v] of [
            ["q", draftQ.trim()],
            ["id", draftId.trim()],
          ] as const) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          setParams(next, { replace: true });
        }}
      >
        <select className="field" value={level} onChange={(e) => set("level", e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <select className="field" value={file} onChange={(e) => set("file", e.target.value)}>
          <option value="">全部来源</option>
          {files.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          {phone ? <option value="phone">phone（手机）</option> : null}
        </select>
        <input
          className="field"
          placeholder="编号（单号、回合、故事，开头几位就行）"
          value={draftId}
          onChange={(e) => setDraftId(e.target.value)}
          style={{ width: 280 }}
        />
        <input
          className="field"
          placeholder="关键字"
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          style={{ width: 200 }}
        />
        <button className="btn" type="submit">
          筛选
        </button>
        <label className="toggle">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          实时
        </label>
      </form>
      {error ? <ErrorBox error={error} /> : null}
      <div
        ref={parent}
        className="logview"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {shown.length === 0 ? <div className="empty">没有符合条件的记录。</div> : null}
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((row) => {
            const entry = shown[row.index];
            if (!entry) return null;
            const info = entryInfo(entry);
            return (
              <div
                key={entry.n}
                className={`logline${selected?.n === entry.n ? " selected" : ""}`}
                style={{ transform: `translateY(${row.start}px)` }}
                onClick={() => setSelected(entry)}
              >
                <span className="mono mut">{clockMs(entry.t)}</span>
                <span>
                  {entry.level === "info" || entry.level === "debug" ? (
                    <span className="mut small">{entry.level}</span>
                  ) : (
                    <Pill tone={levelTone(entry.level)}>{entry.level}</Pill>
                  )}
                </span>
                <span className={`small ${entry.file === "phone" ? "" : "mut"}`}>
                  {entry.file === "phone" ? <Pill tone="acc">手机</Pill> : entry.file}
                </span>
                <span className="text">
                  <span className={`dot c-${info.category}`} style={{ display: "inline-block", marginRight: 8 }} />
                  {describeEntry(entry)}
                  <span className="mut mono" style={{ marginLeft: 10 }}>
                    {entry.event}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {selected ? (
        <div className="drawer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b>{describeEntry(selected)}</b>
            <button className="btn" type="button" onClick={() => setSelected(null)}>
              关闭
            </button>
          </div>
          <EntryFields entry={selected} />
        </div>
      ) : null}
    </div>
  );
}
