/**
 * 连接测试（W17，同 App 的 ProbeBody，M0 的 SSE 探针）：跑一条长流，验证中文不乱码、断网续传、延迟。
 * 网页只测打开它的这个服务器（同源）。右栏够宽时分两栏：左边说明、测试时长、开始 / 模拟断线 / 停止、实时；右边报告、诊断日志。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  DEFAULT_PROBE_CONFIG,
  ProbeSession,
  type ProbeProgress,
  type ProbeReport,
} from "@bettertavern/core/probe/probeSession";

import { Button, cx, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { Diagnostics } from "./Diagnostics.tsx";
import { BodyHead, SectionHeader } from "./parts.tsx";
import { Segmented } from "./Segmented.tsx";
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
      aria-label="延迟走势"
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
        title="报告"
        meta={`上一次 · ${DURATIONS.find((d) => Number(d.value) === duration)?.label ?? `${duration}s`}`}
      />
      <div className={styles.report}>
        <div className={cx(styles.verdict, report.passed ? styles.verdictOk : styles.verdictFail)}>
          <span className={styles.verdictMark}>
            <Icon name={report.passed ? "check" : "cross"} size={26} strokeWidth={2.4} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.verdictTitle}>{report.passed ? "通过" : "未通过"}</span>
            <span className={styles.rowSub}>
              断线 {report.reconnects} 次，{report.integrityOk ? "续传完整" : "文本不一致"}
            </span>
          </span>
        </div>
        {row("模式", report.mode === "sse" ? "SSE" : "轮询降级")}
        {report.mode === "polling" ? (
          <p className={styles.warnNote}>这一跳可能在缓冲 SSE（反向代理或网关），事件流被降级成了轮询。</p>
        ) : null}
        {row("字符数", report.chars.toLocaleString("en-US"))}
        {row(
          "完整性",
          <span className={report.integrityOk ? styles.okText : styles.errText}>
            {report.integrityOk ? "完整" : "不完整"}
          </span>,
        )}
        {row("重复或缺失", String(report.duplicateOrMissing))}
        <div className={styles.latency}>
          <div className={styles.reportRow}>
            <span>延迟</span>
            <span className={styles.mono}>
              p50 {report.latencyP50Ms ?? "-"} · p95 {report.latencyP95Ms ?? "-"} ms
            </span>
          </div>
          <div className={styles.axis} aria-label={`p50 ${p50} 毫秒，p95 ${p95} 毫秒，目标低于 300 毫秒`}>
            <span
              className={styles.axisRange}
              style={{ left: pct(p50), width: pct(Math.max(p95 - p50, 6)) }}
            />
            <span className={styles.axisTarget} style={{ left: pct(TARGET_MS) }} />
          </div>
          <div className={styles.axisLabels}>
            <span>0</span>
            <span className={styles.errText}>目标 {TARGET_MS}</span>
            <span>{scale}ms</span>
          </div>
        </div>
        {row("续传补发的积压", String(report.backlogEvents))}
        {row("时钟偏差", `${report.clockOffsetMs >= 0 ? "+" : ""}${report.clockOffsetMs} ms`)}
      </div>
    </div>
  );
}

export function ProbeBody() {
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
  useDocumentTitle("连接测试");

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
              <Pill label="开发者工具" className={styles.devPill} />
              <br />
              连接测试
            </>
          }
          lead="模拟一次长时间的流式输出，检查断线续传是否完整、延迟是否够低。服务端要开启探针接口（ENABLE_PROBE_ENDPOINTS）。"
        />
        <div className={styles.formCard}>
          <div className={styles.formGroup}>
            <span className={styles.formLabel}>服务器</span>
            <span className={styles.server}>
              <Icon name="server" size={18} />
              <span className={styles.mono}>{window.location.host}</span>
            </span>
          </div>
          <div className={styles.formGroup}>
            <span className={styles.formLabel}>测试时长</span>
            <Segmented
              label="测试时长"
              value={duration}
              options={DURATIONS}
              onChange={setDuration}
              mono
              disabled={running}
            />
          </div>
          <div className={styles.probeButtons}>
            <Button label="开始" icon="play" disabled={running} onClick={() => void start()} />
            <Button
              label="模拟断线"
              icon="disconnect"
              variant="secondary"
              disabled={!running}
              onClick={() => session.current?.dropConnection()}
            />
            <Button
              label="停止"
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
              title="实时"
              meta={
                <Pill
                  tone={running ? (live ? "acc" : "warn") : "grey"}
                  dot={running}
                  label={
                    <>
                      {running
                        ? live
                          ? "接收中"
                          : progress.state === "polling"
                            ? "轮询中"
                            : "重连中"
                        : "已结束"}{" "}
                      · <span className={styles.mono}>{clock(elapsed)}</span>
                    </>
                  }
                />
              }
            />
            <div className={styles.tiles}>
              <div className={styles.tile}>
                <span className={styles.cellKey}>事件数</span>
                <span className={styles.tileValue}>{progress.events.toLocaleString("en-US")}</span>
              </div>
              <div className={styles.tile}>
                <span className={styles.cellKey}>重连次数</span>
                <span className={styles.tileValue}>{progress.reconnects}</span>
              </div>
            </div>
            <div className={styles.tile}>
              <div className={styles.reportRow}>
                <span className={styles.cellKey}>最近延迟</span>
                <span className={styles.mono}>
                  {progress.lastLatencyMs === null ? "-" : Math.round(progress.lastLatencyMs)} ms
                </span>
              </div>
              <Spark values={latencies} />
            </div>
            {tail.length > 0 ? (
              <div className={styles.tile}>
                <span className={styles.cellKey}>最近 300 字</span>
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
        {error ? <p className={cx(styles.note, styles.errText)}>出错：{error}</p> : null}
        <Diagnostics />
      </div>
    </div>
  );
}
