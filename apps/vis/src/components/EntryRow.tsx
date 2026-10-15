/**
 * 一条日志记录：时间（或相对时间）、分类圆点、中文的一句话，点开看全部字段（字段名和值都翻译过）。
 * 回合详情的步骤清单、请求详情都用它。
 */

import { forwardRef } from "react";
import { Link } from "react-router-dom";

import type { LogEntry } from "../api.ts";
import { describeEntry, entryInfo, fieldLabel, fieldValue } from "../lib/catalog.ts";
import { clockMs, offset } from "../lib/format.ts";
import { IdChip } from "./common.tsx";

const HIDDEN = new Set(["n", "t", "file", "event", "level", "timestamp", "logger"]);
const IDS = new Set(["request_id", "turn_id", "playthrough_id", "job_id"]);

export function EntryFields({ entry }: { entry: LogEntry }) {
  const keys = Object.keys(entry).filter((k) => !HIDDEN.has(k));
  return (
    <div className="fields">
      <span className="k">事件</span>
      <span className="mono">{entry.event}</span>
      <span className="k">时间</span>
      <span className="mono">{entry.timestamp ?? clockMs(entry.t)}</span>
      <span className="k">日志文件</span>
      <span className="mono">
        {entry.file} · {String(entry.logger ?? "")}
      </span>
      {keys.map((k) => {
        const value = entry[k];
        return (
          <FieldRow key={k} name={k}>
            {IDS.has(k) && typeof value === "string" ? (
              <IdLink kind={k} id={value} />
            ) : typeof value === "object" && value !== null ? (
              <pre>{JSON.stringify(value, null, 2)}</pre>
            ) : k === "exception" ? (
              <pre>{String(value)}</pre>
            ) : (
              fieldValue(k, value)
            )}
          </FieldRow>
        );
      })}
    </div>
  );
}

function FieldRow({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <span className="k" title={name}>
        {fieldLabel(name)}
      </span>
      <span>{children}</span>
    </>
  );
}

export function IdLink({ kind, id }: { kind: string; id: string }) {
  const href =
    kind === "request_id"
      ? `/requests/${id}`
      : kind === "turn_id"
        ? `/turns/${id}`
        : kind === "playthrough_id"
          ? `/stories/${id}`
          : null;
  return href ? (
    <Link to={href}>
      <IdChip id={id} length={12} />
    </Link>
  ) : (
    <IdChip id={id} length={12} />
  );
}

type Props = {
  entry: LogEntry;
  origin?: number | null;
  open: boolean;
  selected?: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
};

export const EntryRow = forwardRef<HTMLDivElement, Props>(function EntryRow(
  { entry, origin, open, selected, onToggle, extra },
  ref,
) {
  const info = entryInfo(entry);
  return (
    <div ref={ref} className={`step${selected ? " selected" : ""}`}>
      <div className="step-head" onClick={onToggle} role="button" aria-expanded={open}>
        <span className="mono mut">
          {origin !== null && origin !== undefined ? offset(entry.t - origin) : clockMs(entry.t)}
        </span>
        <span className={`dot c-${info.category} lv-${entry.level}`} />
        <span>{describeEntry(entry)}</span>
        <span className="mut small">{extra ?? info.label}</span>
      </div>
      {open ? <EntryFields entry={entry} /> : null}
    </div>
  );
});
