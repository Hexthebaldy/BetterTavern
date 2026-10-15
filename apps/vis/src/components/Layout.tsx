/**
 * 页面框架：左边导航，顶上全局搜索（粘贴任意编号：请求单号、回合编号、故事编号，前几位也行）。
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { getJson, useMeta, type SearchResult } from "../api.ts";
import { usePhone } from "../phoneContext.tsx";
import { ago, bytes } from "../lib/format.ts";
import { phoneRequestIds } from "../lib/phone.ts";
import { IdChip, usePref } from "./common.tsx";

const NAV = [
  { to: "/", label: "概览", icon: "◎", end: true },
  { to: "/stories", label: "故事与回合", icon: "▤" },
  { to: "/requests", label: "请求", icon: "⇅" },
  { to: "/logs", label: "原始日志", icon: "≡" },
];

const KIND_LABELS: Record<string, string> = { request: "请求单号", turn: "回合", playthrough: "故事" };

function target(result: SearchResult): string {
  if (result.kind === "request") return `/requests/${result.id}`;
  if (result.kind === "turn") return `/turns/${result.id}`;
  return `/stories/${result.id}`;
}

function Search() {
  const navigate = useNavigate();
  const { phone } = usePhone();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const value = q.trim();
    if (!value) return;
    setError(null);
    try {
      const found = (await getJson<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(value)}`)).results;
      // 服务端没收到的请求只在手机日志里有，也要能搜到
      const known = new Set(found.map((r) => r.id));
      for (const id of phoneRequestIds(phone, value)) {
        if (!known.has(id)) found.push({ kind: "request", id, title: "只在手机日志里" });
      }
      if (found.length === 1 && found[0]) {
        navigate(target(found[0]));
        setResults(null);
        setQ("");
      } else {
        setResults(found);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form className="search" onSubmit={(e) => void submit(e)}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setResults(null);
        }}
        placeholder="粘贴编号：请求单号、回合编号、故事编号（前 6 位以上就行），回车"
        aria-label="按编号查找"
      />
      {results !== null || error ? (
        <div className="dropdown" onMouseLeave={() => setResults(null)}>
          {error ? <div className="empty">{error}</div> : null}
          {results?.length === 0 ? <div className="empty">没找到。日志里可能已经没有这条记录了。</div> : null}
          {results?.map((r) => (
            <button
              key={`${r.kind}${r.id}`}
              type="button"
              onClick={() => {
                navigate(target(r));
                setResults(null);
                setQ("");
              }}
            >
              <span className="mut" style={{ width: 64 }}>
                {KIND_LABELS[r.kind]}
              </span>
              <IdChip id={r.id} length={12} />
              <span className="mut">
                {r.title ?? ""}
                {r.seq !== undefined ? ` · 第 ${r.seq} 回合` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = usePref("vis.theme", "auto");
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  const next = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  const label = theme === "auto" ? "跟随系统" : theme === "light" ? "浅色" : "深色";
  return (
    <button type="button" className="btn" onClick={() => setTheme(next)} title="切换主题">
      主题：{label}
    </button>
  );
}

function PhoneLoader() {
  const { phone, name, load, clear } = usePhone();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const read = async (file: File): Promise<void> => {
    const parsed = load(await file.text(), file.name);
    if (parsed.entries.length === 0) alert("这个文件里没有认得出的手机诊断日志。");
  };
  useEffect(() => {
    const over = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent): void => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void read(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });
  return (
    <>
      {phone ? (
        <div>
          手机日志：{phone.entries.length} 条
          <br />
          <span className="mono" title={name ?? ""}>
            {name}
          </span>{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), clear())}>
            移除
          </a>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => input.current?.click()} title="也可以直接把文件拖进页面">
          载入手机诊断日志
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept=".txt,.jsonl,.log,text/plain"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
          e.target.value = "";
        }}
      />
      {dragging ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "color-mix(in srgb, var(--acc) 12%, transparent)",
            display: "grid",
            placeItems: "center",
            fontSize: 18,
            pointerEvents: "none",
          }}
        >
          松手载入手机诊断日志（只在这个页面里，不会上传）
        </div>
      ) : null}
    </>
  );
}

export function Layout() {
  const meta = useMeta();
  const logs = meta.data?.logs;
  const size = logs?.files.reduce((sum, f) => sum + f.bytes, 0) ?? 0;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          BetterTavern vis
          <small>本机日志与回合查看器</small>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <b style={{ width: 16, textAlign: "center" }}>{item.icon}</b>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {meta.data ? (
            <>
              <div>数据库：{meta.data.db ? "已连接" : <span style={{ color: "var(--err)" }}>连不上</span>}</div>
              <div>
                日志：{logs?.entries ?? 0} 条 · {bytes(size)}
                <br />
                最新一条 {ago(logs?.newest)}
              </div>
              <div className="mono" style={{ wordBreak: "break-all" }} title="日志目录">
                {logs?.directory}
              </div>
            </>
          ) : meta.error ? (
            <div style={{ color: "var(--err)" }}>连不上 vis 服务</div>
          ) : null}
          <PhoneLoader />
          <ThemeSwitch />
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <Search />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
