/**
 * 回合详情：标题行 → 问题提示 → 瀑布图 → 步骤清单 → 模型调用卡片 → 故事内容（默认隐藏）。
 * 瀑布图、问题提示、步骤清单三者联动：点哪一个，步骤清单里对应的那条就高亮并展开。
 */

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useMeta, useTurn, type Issue, type Run, type Turn } from "../api.ts";
import { ErrorBox, IdChip, Loading, Notice, Pill, statusTone, usePref } from "../components/common.tsx";
import { EntryRow } from "../components/EntryRow.tsx";
import { Waterfall } from "../components/Waterfall.tsx";
import {
  ACTION_SOURCES,
  errorClass,
  errorCode,
  issueText,
  OPTION_SOURCES,
  PARSE_STAGES,
  SEVERITY_LABELS,
  TURN_STATUS,
} from "../lib/catalog.ts";
import { clock, duration, percent, tokens } from "../lib/format.ts";

const SEVERITY_ICON: Record<string, string> = { error: "✕", warn: "!", info: "i" };

function Header({ turn, story }: { turn: Turn; story: boolean }) {
  const run = turn.run;
  return (
    <>
      <div className="crumbs">
        <Link to="/stories">故事</Link> / <Link to={`/stories/${turn.playthrough_id}`}>{turn.playthrough_title}</Link>
      </div>
      <div className="page-head">
        <h1>
          第 {turn.seq} 回合{turn.attempt > 0 ? ` · 第 ${turn.attempt + 1} 次尝试` : ""}
        </h1>
        <Pill tone={statusTone(turn.status)}>{TURN_STATUS[turn.status] ?? turn.status}</Pill>
        <span className="mut">
          {ACTION_SOURCES[turn.action.source ?? ""] ?? turn.action.source}
          {turn.action.option_id ? ` ${turn.action.option_id}` : ""}
          {!story && turn.action.text_chars ? ` · ${turn.action.text_chars} 字` : ""}
          {" · "}
          {clock(turn.created_at)}
          {turn.duration_ms !== null ? ` · 共 ${duration(turn.duration_ms)}` : ""}
          {run ? ` · ${run.model ?? ""}` : ""}
          {run?.output_tokens ? ` · 输出 ${tokens(run.output_tokens)} token` : ""}
        </span>
        <IdChip id={turn.id} length={12} />
      </div>
      {turn.error ? (
        <Notice tone="error">
          <b>{errorCode(turn.error.code)}</b>
          {turn.error.message ? `：${turn.error.message}` : ""}
          <span className="mono"> （{turn.error.code}）</span>
        </Notice>
      ) : null}
    </>
  );
}

function Issues({ issues, onSelect }: { issues: Issue[]; onSelect: (ref: number | null) => void }) {
  if (issues.length === 0) {
    return <div className="notice">没发现问题。</div>;
  }
  return (
    <div className="issues">
      {issues.map((issue, i) => (
        <button key={i} type="button" className={`issue ${issue.severity}`} onClick={() => onSelect(issue.ref)}>
          <Pill tone={issue.severity === "info" ? undefined : issue.severity === "warn" ? "warn" : "error"}>
            {SEVERITY_ICON[issue.severity]} {SEVERITY_LABELS[issue.severity]}
          </Pill>
          <span>{issueText(issue.code, issue.fields)}</span>
        </button>
      ))}
    </div>
  );
}

const AGENTS: Record<string, string> = { director: "导演（写叙述和选项）", world_builder: "搭建世界" };

function RunCard({ run }: { run: Run }) {
  const input = run.input_tokens ?? 0;
  const cached = run.cached_tokens ?? 0;
  const output = run.output_tokens ?? 0;
  const reasoning = run.reasoning_tokens ?? 0;
  const total = input + output || 1;
  const result = run.result ?? {};
  return (
    <div className="card runcard">
      <h3>
        {AGENTS[run.agent] ?? run.agent}{" "}
        <Pill tone={statusTone(run.status)}>{run.status === "ok" ? "成功" : "失败"}</Pill>
      </h3>
      <div className="mut small">
        {run.provider} · {run.model}
      </div>
      {input || output ? (
        <>
          <div className="tokenbar" title="灰：缓存命中的输入；浅蓝：没命中的输入；蓝：输出">
            <i style={{ width: `${(cached / total) * 100}%`, background: "var(--line2)" }} />
            <i style={{ width: `${((input - cached) / total) * 100}%`, background: "var(--c-wait)" }} />
            <i style={{ width: `${(output / total) * 100}%`, background: "var(--c-stream)" }} />
          </div>
        </>
      ) : null}
      <div className="kv">
        <span className="k">输入</span>
        <span>
          {tokens(run.input_tokens)} token，缓存命中 {tokens(run.cached_tokens)}（
          {input ? percent(cached / input) : "–"}）
        </span>
        <span className="k">输出</span>
        <span>
          {tokens(run.output_tokens)} token{reasoning ? `，其中思考 ${tokens(reasoning)}` : ""}
        </span>
        <span className="k">首字等待</span>
        <span>{duration(run.ttft_ms)}</span>
        <span className="k">总耗时</span>
        <span>{duration(run.latency_ms)}</span>
        {run.error_class ? (
          <>
            <span className="k">失败原因</span>
            <span>{errorClass(run.error_class)}</span>
          </>
        ) : null}
        {typeof result.stage === "string" ? (
          <>
            <span className="k">格式检查</span>
            <span>{PARSE_STAGES[result.stage] ?? result.stage}</span>
          </>
        ) : null}
        {Array.isArray(result.repairs) && result.repairs.length > 0 ? (
          <>
            <span className="k">修补</span>
            <span>{result.repairs.join("；")}</span>
          </>
        ) : null}
        {typeof result.finish_reason === "string" ? (
          <>
            <span className="k">结束原因</span>
            <span>{result.finish_reason}</span>
          </>
        ) : null}
        {typeof result.usage_ratio === "number" ? (
          <>
            <span className="k">占窗口</span>
            <span>
              {percent(result.usage_ratio, 1)}
              {typeof result.dropped_turns === "number" && result.dropped_turns > 0
                ? `，丢掉 ${result.dropped_turns} 个旧回合`
                : ""}
            </span>
          </>
        ) : null}
        {result.fallback_used ? (
          <>
            <span className="k">备用模型</span>
            <span>用了</span>
          </>
        ) : null}
        <span className="k">提示词指纹</span>
        <span className="mono">{run.prompt_hash ?? "–"}</span>
      </div>
    </div>
  );
}

function Story({ turn, allowed }: { turn: Turn; allowed: boolean }) {
  const [shown, setShown] = usePref("vis.story", "0");
  if (!allowed) return null;
  const on = shown === "1";
  return (
    <>
      <h2>
        故事内容{" "}
        <label className="toggle" style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={on} onChange={(e) => setShown(e.target.checked ? "1" : "0")} />
          显示（只在开发环境可用）
        </label>
      </h2>
      {on ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="mut small">玩家的行动</div>
          <div className="story">{turn.action.text || "（开场，没有行动）"}</div>
          <div className="mut small">叙述</div>
          <div className="story">{turn.narrative || "（空）"}</div>
          {turn.options && turn.options.length > 0 ? (
            <>
              <div className="mut small">
                选项（来自{OPTION_SOURCES[turn.options_source ?? ""] ?? turn.options_source ?? "–"}）
              </div>
              <div className="story">
                {turn.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="notice">
          已隐藏：行动 {turn.action.text_chars} 字，叙述 {turn.narrative_chars} 字，{turn.options_count} 个选项。
        </div>
      )}
    </>
  );
}

export function TurnDetail() {
  const { id = "" } = useParams();
  const meta = useMeta();
  const [storyPref] = usePref("vis.story", "0");
  const story = storyPref === "1" && meta.data?.story_allowed === true;
  const { data, error, isLoading } = useTurn(id, story);
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rows = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    setSelected(null);
    setOpen(new Set());
  }, [id]);

  const select = (ref: number | null): void => {
    setSelected(ref);
    if (ref === null) return;
    setOpen((prev) => new Set(prev).add(ref));
    requestAnimationFrame(() => rows.current.get(ref)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  if (isLoading) return <Loading />;
  if (error) {
    return (
      <div className="page">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!data) return null;
  const { turn, timeline, entries, issues, runs, neighbours } = data;
  const origin = timeline.origin;
  const index = neighbours.findIndex((n) => n.id === id);
  const prev = index > 0 ? neighbours[index - 1] : undefined;
  const next = index >= 0 && index < neighbours.length - 1 ? neighbours[index + 1] : undefined;

  return (
    <div className="page">
      {data.db_error ? <Notice tone="warn">{data.db_error}（下面只有日志里的内容）</Notice> : null}
      {turn ? <Header turn={turn} story={story} /> : <h1>回合 {id.slice(0, 8)}</h1>}
      <div style={{ display: "flex", gap: 14, marginBottom: 14 }} className="small">
        {prev ? <Link to={`/turns/${prev.id}`}>← 第 {prev.seq} 回合</Link> : null}
        {next ? <Link to={`/turns/${next.id}`}>第 {next.seq} 回合 →</Link> : null}
        <Link to={`/logs?id=${id}`}>在原始日志里看</Link>
      </div>

      <h2>问题</h2>
      <Issues issues={issues} onSelect={select} />

      <h2>时间线</h2>
      {origin !== null && timeline.end !== null && timeline.spans.length + timeline.markers.length > 0 ? (
        <Waterfall
          origin={origin}
          end={timeline.end}
          spans={timeline.spans}
          markers={timeline.markers}
          selected={selected}
          onSelect={select}
        />
      ) : (
        <div className="notice">日志里没有这个回合的记录，画不出时间线。</div>
      )}

      <h2>
        步骤 <span className="mut small">共 {entries.length} 条，点一行看全部字段</span>
      </h2>
      <div className="steps">
        {entries.map((entry) => (
          <EntryRow
            key={entry.n}
            ref={(el) => {
              if (el) rows.current.set(entry.n, el);
              else rows.current.delete(entry.n);
            }}
            entry={entry}
            origin={origin}
            selected={selected === entry.n}
            open={open.has(entry.n)}
            onToggle={() =>
              setOpen((prev) => {
                const nextOpen = new Set(prev);
                if (nextOpen.has(entry.n)) nextOpen.delete(entry.n);
                else nextOpen.add(entry.n);
                return nextOpen;
              })
            }
          />
        ))}
      </div>

      {runs.length > 0 ? (
        <>
          <h2>模型调用</h2>
          <div className="grid2">
            {runs.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        </>
      ) : null}

      {turn ? <Story turn={turn} allowed={meta.data?.story_allowed === true} /> : null}
    </div>
  );
}
