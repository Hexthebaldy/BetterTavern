/**
 * 连接测试（W17，同 App 的 ProbeBody，M0 的 SSE 探针）：跑一条长流，验证中文不乱码、断网续传、延迟。
 * 网页只测打开它的这个服务器（同源）。右栏够宽时分两栏：左边说明、测试时长、开始 / 模拟断线 / 停止、实时；右边报告、诊断日志。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  DEFAULT_PROBE_CONFIG,
  ProbeSession,
  type ProbeProgress,
  type ProbeReport,
} from "@bettertavern/core/probe/probeSession";

import { Button, cx, Pill, Segmented } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { Diagnostics } from "./Diagnostics.tsx";
import { BodyHead, SectionHeader } from "./parts.tsx";
import styles from "./settings.module.css";

type Duration = "30" | "60" | "120" | "300";
const DURATIONS: { value: Duration; label: string }[] = [
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
  { value: "120", label: "2m" },
  { value: "300", label: "5m" },
];
const TARGET_MS = 300;
const SPARK_POINTS = 26;

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 最近延迟的走势；虚线是 300ms 的目标 */
function Spark({ values }: { values: number[] }) {
  const { t } = useTranslation();
  const width = 300;
  const height = 60;
  const max = Math.max(TARGET_MS * 1.3, ...values);
  const y = (v: number): number => height - 6 - (v / max) * (height - 14);
  const step = width / (SPARK_POINTS - 1);
  const offset = SPARK_POINTS - values.length;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${(offset + i) * step} ${y(v)}`).join("");
  const peak = values.length > 0 ? values.indexOf(Math.max(...values)) : -1;
  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t("probe.trend")}
    >
      <path
        d={`M0 ${y(TARGET_MS)}H${width}`}
        stroke="var(--err)"
        strokeWidth={1.5}
        strokeDasharray="2 5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {path ? (
        <path
          d={path}
          stroke="var(--ink)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {peak >= 0 && (values[peak] ?? 0) > TARGET_MS ? (
        <circle cx={(offset + peak) * step} cy={y(values[peak] ?? 0)} r={4.5} fill="var(--warn)" />
      ) : null}
    </svg>
  );
}

function ReportView({ report, duration }: { report: ProbeReport; duration: number }) {
  const { t } = useTranslation();
  const row = (label: string, value: ReactNode) => (
    <div className={styles.reportRow}>
      <span>{label}</span>
      {typeof value === "string" ? <span className={styles.mono}>{value}</span> : value}
    </div>
  );
  const scale = 400;
  const p50 = report.latencyP50Ms ?? 0;
  const p95 = report.latencyP95Ms ?? 0;
  const pct = (v: number): string => `${Math.min(v / scale, 1) * 100}%`;
  return (
    <div>
      <SectionHeader
        title={t("probe.report")}
        meta={t("probe.lastRun", {
          duration: DURATIONS.find((d) => Number(d.value) === duration)?.label ?? `${duration}s`,
        })}
      />
      <div className={styles.report}>
        <div className={cx(styles.verdict, report.passed ? styles.verdictOk : styles.verdictFail)}>
          <span className={styles.verdictMark}>
            <Icon name={report.passed ? "check" : "cross"} size={26} strokeWidth={2.4} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.verdictTitle}>
              {report.passed ? t("probe.passed") : t("probe.notPassed")}
            </span>
            <span className={styles.rowSub}>
              {t("probe.summary", {
                count: report.reconnects,
                integrity: report.integrityOk ? t("probe.resumedIntact") : t("probe.textMismatch"),
              })}
            </span>
          </span>
        </div>
        {row(t("probe.mode"), report.mode === "sse" ? "SSE" : t("probe.pollingFallback"))}
        {report.mode === "polling" ? <p className={styles.warnNote}>{t("probe.bufferedNote")}</p> : null}
        {row(t("probe.chars"), report.chars.toLocaleString("en-US"))}
        {row(
          t("probe.integrity"),
          <span className={report.integrityOk ? styles.okText : styles.errText}>
            {report.integrityOk ? t("probe.intact") : t("probe.broken")}
          </span>,
        )}
        {row(t("probe.duplicates"), String(report.duplicateOrMissing))}
        <div className={styles.latency}>
          <div className={styles.reportRow}>
            <span>{t("probe.latency")}</span>
            <span className={styles.mono}>
              p50 {report.latencyP50Ms ?? "-"} · p95 {report.latencyP95Ms ?? "-"} ms
            </span>
          </div>
          <div className={styles.axis} aria-label={t("probe.latencyLabel", { p50, p95, target: TARGET_MS })}>
            <span
              className={styles.axisRange}
              style={{ left: pct(p50), width: pct(Math.max(p95 - p50, 6)) }}
            />
            <span className={styles.axisTarget} style={{ left: pct(TARGET_MS) }} />
          </div>
          <div className={styles.axisLabels}>
            <span>0</span>
            <span className={styles.errText}>{t("probe.target", { target: TARGET_MS })}</span>
            <span>{scale}ms</span>
          </div>
        </div>
        {row(t("probe.backlog"), String(report.backlogEvents))}
        {row(t("probe.clockOffset"), `${report.clockOffsetMs >= 0 ? "+" : ""}${report.clockOffsetMs} ms`)}
      </div>
    </div>
  );
}

export function ProbeBody() {
  const { t } = useTranslation();
  const [duration, setDuration] = useState<Duration>("60");
  const [progress, setProgress] = useState<ProbeProgress | null>(null);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [report, setReport] = useState<{ report: ProbeReport; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const session = useRef<ProbeSession | null>(null);
  const pending = useRef<ProbeProgress | null>(null);
  const frame = useRef<number | null>(null);
  const lastSample = useRef(0);
  useDocumentTitle(t("probe.title"));

  useEffect(
    () => () => {
      session.current?.stop();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [running]);

  // 流式文字先存在 ref 里，最多每帧刷新一次界面；延迟每半秒取一个点画走势
  const onProgress = (next: ProbeProgress): void => {
    pending.current = next;
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const p = pending.current;
        setProgress(p);
        const now = Date.now();
        if (p?.lastLatencyMs != null && now - lastSample.current > 500) {
          lastSample.current = now;
          setLatencies((list) => [...list, Math.round(p.lastLatencyMs ?? 0)].slice(-SPARK_POINTS));
        }
      });
    }
  };

  const start = async (): Promise<void> => {
    setReport(null);
    setError(null);
    setLatencies([]);
    setElapsed(0);
    const probe = new ProbeSession(
      window.location.origin,
      { streamFetch: (url, init) => fetch(url, init), jsonFetch: (url, init) => fetch(url, init) },
      onProgress,
    );
    session.current = probe;
    setRunning(true);
    const durationS = Number(duration);
    try {
      setReport({ report: await probe.run({ ...DEFAULT_PROBE_CONFIG, durationS }), duration: durationS });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      session.current = null;
      setRunning(false);
    }
  };

  const tail = progress ? [...progress.text].slice(-300).join("") : "";
  const live = running && progress?.state === "open";
  return (
    <div className={cx(styles.body, styles.twoColumns)}>
      <div className={styles.column}>
        <BodyHead
          title={
            <>
              <Pill label={t("probe.devTool")} className={styles.devPill} />
              <br />
              {t("probe.title")}
            </>
          }
          lead={t("probe.intro")}
        />
        <div className={styles.formCard}>
          <div className={styles.formGroup}>
            <span className={styles.formLabel}>{t("probe.server")}</span>
            <span className={styles.server}>
              <Icon name="server" size={18} />
              <span className={styles.mono}>{window.location.host}</span>
            </span>
          </div>
          <div className={styles.formGroup}>
            <span className={styles.formLabel}>{t("probe.duration")}</span>
            <Segmented
              label={t("probe.duration")}
              value={duration}
              options={DURATIONS}
              onChange={setDuration}
              mono
              disabled={running}
            />
          </div>
          <div className={styles.probeButtons}>
            <Button label={t("probe.start")} icon="play" disabled={running} onClick={() => void start()} />
            <Button
              label={t("probe.drop")}
              icon="disconnect"
              variant="secondary"
              disabled={!running}
              onClick={() => session.current?.dropConnection()}
            />
            <Button
              label={t("common.stop")}
              icon="stop"
              variant={running ? "primary" : "secondary"}
              disabled={!running}
              onClick={() => session.current?.stop()}
            />
          </div>
        </div>
        {progress ? (
          <>
            <SectionHeader
              title={t("probe.live")}
              meta={
                <Pill
                  tone={running ? (live ? "acc" : "warn") : "grey"}
                  dot={running}
                  label={
                    <>
                      {running
                        ? live
                          ? t("probe.receiving")
                          : progress.state === "polling"
                            ? t("probe.polling")
                            : t("probe.reconnecting")
                        : t("probe.finished")}{" "}
                      · <span className={styles.mono}>{clock(elapsed)}</span>
                    </>
                  }
                />
              }
            />
            <div className={styles.tiles}>
              <div className={styles.tile}>
                <span className={styles.cellKey}>{t("probe.events")}</span>
                <span className={styles.tileValue}>{progress.events.toLocaleString("en-US")}</span>
              </div>
              <div className={styles.tile}>
                <span className={styles.cellKey}>{t("probe.reconnects")}</span>
                <span className={styles.tileValue}>{progress.reconnects}</span>
              </div>
            </div>
            <div className={styles.tile}>
              <div className={styles.reportRow}>
                <span className={styles.cellKey}>{t("probe.lastLatency")}</span>
                <span className={styles.mono}>
                  {progress.lastLatencyMs === null ? "-" : Math.round(progress.lastLatencyMs)} ms
                </span>
              </div>
              <Spark values={latencies} />
            </div>
            {tail.length > 0 ? (
              <div className={styles.tile}>
                <span className={styles.cellKey}>{t("probe.tail")}</span>
                <p className={styles.tail}>
                  {tail}
                  {running ? <span className={styles.tailCaret}>▍</span> : null}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <div className={styles.column}>
        {report ? <ReportView report={report.report} duration={report.duration} /> : null}
        {error ? <p className={cx(styles.note, styles.errText)}>{t("probe.error", { error })}</p> : null}
        <Diagnostics />
      </div>
    </div>
  );
}
