/**
 * 瀑布图：横轴是时间，每一行是一类事情，每一步画成一根横条，长度就是它花的时间。
 * 鼠标移上去看精确时间和字段；点一下，下面的步骤清单跳到对应那条并展开。
 */

import { useMemo, useState } from "react";

import type { Marker, Span } from "../api.ts";
import { fieldLabel, fieldValue, laneLabel, laneRank, MARKER_LABELS, SPAN_LABELS } from "../lib/catalog.ts";
import { duration, offset, ticks } from "../lib/format.ts";

type Hover = { x: number; y: number; title: string; lines: [string, string][] };

const TOOLTIP_FIELDS = [
  "attempt",
  "model",
  "status",
  "route",
  "error_class",
  "error_code",
  "ttft_ms",
  "prompt_tokens",
  "cached_tokens",
  "completion_tokens",
  "reasoning_tokens",
  "finish_reason",
  "retry_in_s",
  "reason",
  "events_sent",
  "resumed_from",
  "backlog",
  "mode",
  "stage",
  "code",
  "source",
  "entities",
  "usage_ratio",
  "estimated_tokens",
];

function lines(fields: Record<string, unknown>): [string, string][] {
  return TOOLTIP_FIELDS.filter((k) => fields[k] !== undefined && fields[k] !== null).map((k) => [
    fieldLabel(k),
    fieldValue(k, fields[k]),
  ]);
}

function spanTitle(span: Span): string {
  const base = SPAN_LABELS[span.kind] ?? span.kind;
  if (span.kind === "http") return `${base} ${String(span.fields.method ?? "")} ${String(span.fields.route ?? "")}`;
  if (span.kind.startsWith("provider") && span.fields.attempt) return `${base}（第 ${String(span.fields.attempt)} 次）`;
  if (span.status === "running") return `${base}（进行中）`;
  return base;
}

export function Waterfall({
  origin,
  end,
  spans,
  markers,
  selected,
  onSelect,
}: {
  origin: number;
  end: number;
  spans: Span[];
  markers: Marker[];
  selected: number | null;
  onSelect: (ref: number | null) => void;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const total = Math.max(end - origin, 1);
  const axis = useMemo(() => ticks(total, 8), [total]);
  const lanes = useMemo(() => {
    const names = new Set<string>([...spans.map((s) => s.lane), ...markers.map((m) => m.lane)]);
    return [...names].sort((a, b) => laneRank(a) - laneRank(b));
  }, [spans, markers]);
  const pos = (t: number): string => `${((t - origin) / total) * 100}%`;

  const show = (e: React.MouseEvent, title: string, rows: [string, string][]): void =>
    setHover({ x: e.clientX + 14, y: e.clientY + 14, title, lines: rows });

  return (
    <div className="waterfall" onMouseLeave={() => setHover(null)}>
      <div className="wf-axis">
        <span />
        <div className="track">
          {axis.map((t) => (
            <span key={t} className="tick" style={{ left: `${(t / total) * 100}%` }}>
              {t === 0 ? "0" : duration(t)}
            </span>
          ))}
        </div>
      </div>
      {lanes.map((lane) => (
        <div className="wf-row" key={lane}>
          <span className="lane">{laneLabel(lane)}</span>
          <div className="track">
            {axis.map((t) => (
              <span key={t} className="wf-grid" style={{ left: `${(t / total) * 100}%` }} />
            ))}
            {spans
              .filter((s) => s.lane === lane)
              .map((s, i) => {
                const width = Math.max(((s.end - s.start) / total) * 100, 0);
                const title = spanTitle(s);
                const rows: [string, string][] = [
                  ["开始", offset(s.start - origin)],
                  ["耗时", duration(s.end - s.start)],
                  ...lines(s.fields),
                ];
                return (
                  <button
                    type="button"
                    key={`${s.kind}${i}`}
                    className={`bar k-${s.kind} s-${s.status}${s.ref !== null && s.ref === selected ? " selected" : ""}`}
                    style={{ left: pos(s.start), width: `${width}%` }}
                    onMouseMove={(e) => show(e, title, rows)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onSelect(s.ref)}
                    aria-label={`${title}，${duration(s.end - s.start)}`}
                  >
                    {width > 9 ? <span>{duration(s.end - s.start)}</span> : null}
                  </button>
                );
              })}
            {markers
              .filter((m) => m.lane === lane)
              .map((m, i) => {
                const title = MARKER_LABELS[m.kind] ?? m.kind;
                return (
                  <button
                    type="button"
                    key={`m${i}`}
                    className={`marker s-${m.status}`}
                    style={{ left: pos(m.at) }}
                    onMouseMove={(e) => show(e, title, [["时间", offset(m.at - origin)], ...lines(m.fields)])}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onSelect(m.ref)}
                    aria-label={title}
                  />
                );
              })}
          </div>
        </div>
      ))}
      <div className="legend">
        <span>
          <i style={{ background: "var(--c-wait)" }} />
          等第一个字
        </span>
        <span>
          <i style={{ background: "var(--c-stream)" }} />
          吐字
        </span>
        <span>
          <i style={{ background: "var(--err)" }} />
          失败
        </span>
        <span>
          <i
            style={{
              background: "repeating-linear-gradient(135deg, var(--warn) 0 4px, transparent 4px 8px)",
              boxShadow: "inset 0 0 0 1px var(--warn)",
            }}
          />
          等待（重试、并发槽位）
        </span>
        <span>
          <i style={{ background: "var(--c-steps)" }} />
          步骤
        </span>
        <span>
          <i style={{ background: "var(--c-sse)" }} />
          推送连接
        </span>
        <span>
          <i style={{ background: "var(--c-steps)", borderRadius: 4, width: 8 }} />
          时间点
        </span>
      </div>
      {hover ? (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="title">{hover.title}</div>
          {hover.lines.map(([k, v]) => (
            <div key={k}>
              <span className="mut">{k}</span> {v}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
