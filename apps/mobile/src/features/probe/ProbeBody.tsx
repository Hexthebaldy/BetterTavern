/**
 * 连接测试（M0 的 SSE 探针）：在真机上跑一条长流，验证中文不乱码、断网续传、延迟。
 * 登录前后都能打开，用来排查服务器地址、代理缓冲之类的问题。验收标准见 docs/client.md（要跑 3 分钟以上，选 5m）。
 * 路由页面是 app/dev/probe.tsx；宽屏设置两栏时嵌在右栏里（见 ../settings/nav.tsx）。
 * 漫画风：几块都是白底墨线的格子；通过是深绿、没通过是红，都配图标。
 */

import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";

import type { FetchLike } from "@bettertavern/core/api/sse/sseClient";
import {
  DEFAULT_PROBE_CONFIG,
  ProbeSession,
  type ProbeProgress,
  type ProbeReport,
} from "@bettertavern/core/probe/probeSession";

import { ServerSheet } from "../../components/ServerSetting.tsx";
import { DiagnosticsCard } from "./DiagnosticsCard.tsx";
import { Button, Icon, Page, Pill, SectionHeader, Segmented } from "../../components/ui.tsx";
import { SettingsBack } from "../settings/nav.tsx";
import { displayServer } from "../settings/servers.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { comicRadius, comicStroke, font, space, useComic } from "../../theme/index.ts";

const streamFetch: FetchLike = (url, init) => expoFetch(url, init);
const jsonFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => fetch(url, init);

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
function Spark({ values, width }: { values: number[]; width: number }) {
  const c = useComic();
  const { t } = useTranslation();
  const height = 60;
  const max = Math.max(TARGET_MS * 1.3, ...values);
  const y = (v: number): number => height - 6 - (v / max) * (height - 14);
  const step = width / (SPARK_POINTS - 1);
  const offset = SPARK_POINTS - values.length;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${(offset + i) * step} ${y(v)}`).join("");
  const peak = values.length > 0 ? values.indexOf(Math.max(...values)) : -1;
  return (
    <Svg width={width} height={height} accessibilityLabel={t("probe.trend")}>
      <Path
        d={`M0 ${y(TARGET_MS)}H${width}`}
        stroke={c.err}
        strokeWidth={1.5}
        strokeDasharray="2 5"
        strokeLinecap="round"
      />
      <SvgText x={width} y={y(TARGET_MS) - 4} textAnchor="end" fontSize={9} fill={c.err}>
        300ms
      </SvgText>
      {path ? (
        <Path
          d={path}
          stroke={c.ink}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
      {peak >= 0 && (values[peak] ?? 0) > TARGET_MS ? (
        <Circle cx={(offset + peak) * step} cy={y(values[peak] ?? 0)} r={4.5} fill={c.warn} />
      ) : null}
    </Svg>
  );
}

function ReportView({ report, duration }: { report: ProbeReport; duration: number }) {
  const c = useComic();
  const { t } = useTranslation();
  const tone = report.passed ? c.forest : c.err;
  const row = (label: string, value: ReactNode) => (
    <View style={styles.kv}>
      <Text style={{ fontSize: 14, color: c.ink }}>{label}</Text>
      {typeof value === "string" ? <Text style={[styles.mono, { color: c.ink }]}>{value}</Text> : value}
    </View>
  );
  const sep = <View style={[styles.sep, { backgroundColor: c.grey2 }]} />;
  const scale = 400;
  const p50 = report.latencyP50Ms ?? 0;
  const p95 = report.latencyP95Ms ?? 0;
  const pct = (v: number): `${number}%` => `${Math.min(v / scale, 1) * 100}%`;
  return (
    <View>
      <SectionHeader
        title={t("probe.report")}
        meta={t("probe.lastRun", {
          duration: DURATIONS.find((d) => Number(d.value) === duration)?.label ?? `${duration}s`,
        })}
      />
      <View style={[styles.report, { backgroundColor: c.paper, borderColor: c.ink }]}>
        <View style={[styles.verdict, { backgroundColor: c.paper }]}>
          <View style={[styles.verdictMark, { backgroundColor: tone, borderColor: c.ink }]}>
            <Icon name={report.passed ? "check" : "cross"} size={26} color={c.paper} strokeWidth={2.6} />
          </View>
          <View>
            <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: "900", color: c.ink }}>
              {report.passed ? t("probe.passed") : t("probe.notPassed")}
            </Text>
            <Text style={{ fontSize: 13, color: c.ink2 }}>
              {t("probe.summary", {
                count: report.reconnects,
                integrity: report.integrityOk ? t("probe.resumedIntact") : t("probe.textMismatch"),
              })}
            </Text>
          </View>
        </View>
        {row(t("probe.mode"), report.mode === "sse" ? "SSE" : t("probe.pollingFallback"))}
        {report.mode === "polling" ? (
          <Text style={[styles.note, { color: c.warn }]}>{t("probe.bufferedNote")}</Text>
        ) : null}
        {sep}
        {row(t("probe.chars"), report.chars.toLocaleString("en-US"))}
        {sep}
        {row(
          t("probe.integrity"),
          <View style={styles.inline}>
            <Icon name={report.integrityOk ? "check" : "cross"} size={15} color={tone} strokeWidth={2.2} />
            <Text style={{ fontSize: 14, color: tone }}>
              {report.integrityOk ? t("probe.intact") : t("probe.broken")}
            </Text>
          </View>,
        )}
        {sep}
        {row(t("probe.duplicates"), String(report.duplicateOrMissing))}
        {sep}
        <View style={styles.latency}>
          <View style={styles.inlineBetween}>
            <Text style={{ fontSize: 14, color: c.ink }}>{t("probe.latency")}</Text>
            <Text style={[styles.mono, { color: c.ink }]}>
              p50 {report.latencyP50Ms ?? "-"} · p95 {report.latencyP95Ms ?? "-"} ms
            </Text>
          </View>
          <View
            style={[styles.axis, { backgroundColor: c.grey, borderColor: c.ink }]}
            accessibilityLabel={t("probe.latencyLabel", { p50, p95, target: TARGET_MS })}
          >
            <View
              style={[
                styles.range,
                { left: pct(p50), width: pct(Math.max(p95 - p50, 6)), backgroundColor: c.ink },
              ]}
            />
            <View style={[styles.target, { left: pct(TARGET_MS), backgroundColor: c.err }]} />
          </View>
          <View style={styles.inlineBetween}>
            <Text style={[styles.axisLabel, { color: c.mut }]}>0</Text>
            {/* 目标线的说明对准目标线，右端对齐 */}
            <Text
              style={[
                styles.axisLabel,
                styles.targetLabel,
                { right: pct(scale - TARGET_MS), color: c.err },
              ]}
            >
              {t("probe.target", { target: TARGET_MS })}
            </Text>
            <Text style={[styles.axisLabel, { color: c.mut }]}>{scale}ms</Text>
          </View>
        </View>
        {sep}
        {row(t("probe.backlog"), String(report.backlogEvents))}
        {sep}
        {row(t("probe.clockOffset"), `${report.clockOffsetMs >= 0 ? "+" : ""}${report.clockOffsetMs} ms`)}
      </View>
    </View>
  );
}

/** url：要测的服务器（登录页的服务器设置会带过来）；不传就测当前的服务器 */
export function ProbeBody({ url }: { url?: string }) {
  const { serverUrl } = useApp();
  const c = useComic();
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(url || serverUrl);
  const [picking, setPicking] = useState(false);
  const [duration, setDuration] = useState<Duration>("60");
  const [progress, setProgress] = useState<ProbeProgress | null>(null);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [report, setReport] = useState<{ report: ProbeReport; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [width, setWidth] = useState(350);
  const session = useRef<ProbeSession | null>(null);
  const pending = useRef<ProbeProgress | null>(null);
  const frame = useRef<number | null>(null);
  const lastSample = useRef(0);

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
    const probe = new ProbeSession(baseUrl.trim(), { streamFetch, jsonFetch }, onProgress);
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
  const liveTone = running ? (live ? "acc" : "warn") : "grey";
  return (
    <Page header={<SettingsBack />}>
      <View style={styles.head}>
        <Pill label={t("probe.devTool")} tone="grey" height={26} />
        <Text accessibilityRole="header" style={[styles.big, { color: c.ink }]}>
          {t("probe.title")}
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 22, color: c.mut }}>{t("probe.intro")}</Text>
      </View>

      <View style={[styles.controls, { backgroundColor: c.paper, borderColor: c.ink }]}>
        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: c.ink2 }]}>{t("probe.server")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("server.rowLabel", { server: displayServer(baseUrl) })}
            disabled={running}
            onPress={() => setPicking(true)}
            style={[styles.select, { backgroundColor: c.paper, borderColor: running ? c.disabledLine : c.ink }]}
          >
            <Icon name="server" size={18} color={running ? c.mut : c.ink} />
            <Text numberOfLines={1} style={[styles.mono, { flex: 1, color: running ? c.mut : c.ink }]}>
              {displayServer(baseUrl)}
            </Text>
            <Icon name="chevronDown" size={18} color={running ? c.mut : c.ink} />
          </Pressable>
        </View>
        <Segmented
          label={t("probe.duration")}
          value={duration}
          options={DURATIONS}
          onChange={setDuration}
          mono
          height={52}
        />
        <View style={styles.buttons}>
          <Button
            label={t("probe.start")}
            icon="play"
            onPress={() => void start()}
            disabled={running}
            style={styles.wide}
          />
          <Button
            label={t("probe.drop")}
            icon="disconnect"
            variant="secondary"
            onPress={() => session.current?.dropConnection()}
            disabled={!running}
            style={styles.flex}
          />
          <Button
            label={t("common.stop")}
            icon="stop"
            variant={running ? "primary" : "secondary"}
            onPress={() => session.current?.stop()}
            disabled={!running}
            style={styles.flex}
          />
        </View>
      </View>

      {progress ? (
        <>
          <SectionHeader
            title={t("probe.live")}
            meta={
              <Pill
                tone={liveTone}
                dot={running}
                height={28}
                label={
                  <>
                    {running
                      ? live
                        ? t("probe.receiving")
                        : progress.state === "polling"
                          ? t("probe.polling")
                          : t("probe.reconnecting")
                      : t("probe.finished")}{" "}
                    · <Text style={{ fontFamily: font.mono }}>{clock(elapsed)}</Text>
                  </>
                }
              />
            }
          />
          <View style={styles.tiles}>
            <View style={[styles.tile, { backgroundColor: c.paper, borderColor: c.ink }]}>
              <Text style={[styles.key, { color: c.mut }]}>{t("probe.events")}</Text>
              <Text style={[styles.value, { color: c.ink }]}>
                {progress.events.toLocaleString("en-US")}
              </Text>
            </View>
            <View style={[styles.tile, { backgroundColor: c.paper, borderColor: c.ink }]}>
              <Text style={[styles.key, { color: c.mut }]}>{t("probe.reconnects")}</Text>
              <Text style={[styles.value, { color: c.ink }]}>{progress.reconnects}</Text>
            </View>
          </View>
          <View
            style={[styles.tile, styles.spark, { backgroundColor: c.paper, borderColor: c.ink }]}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width - space.l * 2)}
          >
            <View style={styles.inlineBetween}>
              <Text style={[styles.key, { color: c.mut }]}>{t("probe.lastLatency")}</Text>
              <Text style={[styles.mono, { fontSize: 20, color: c.ink }]}>
                {progress.lastLatencyMs === null ? "-" : Math.round(progress.lastLatencyMs)}{" "}
                <Text style={{ fontSize: 12, color: c.mut }}>ms</Text>
              </Text>
            </View>
            <Spark values={latencies} width={width} />
          </View>
          {tail.length > 0 ? (
            <View style={[styles.tail, { backgroundColor: c.paper, borderColor: c.ink }]}>
              <Text style={[styles.key, { color: c.mut, marginBottom: 6 }]}>{t("probe.tail")}</Text>
              <Text style={[styles.mono, { fontSize: 12, lineHeight: 19, color: c.ink2 }]}>
                {tail}
                {running ? <Text style={{ color: c.acc }}>▍</Text> : null}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      {report ? <ReportView report={report.report} duration={report.duration} /> : null}
      {error ? (
        <Text style={[styles.note, { color: c.err }]}>{t("probe.error", { error })}</Text>
      ) : null}
      <DiagnosticsCard />
      <ServerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        value={baseUrl}
        onSave={setBaseUrl}
        showProbe={false}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.page, paddingTop: space.l, paddingBottom: space.s, gap: space.s },
  big: { fontSize: 32, lineHeight: 40, fontWeight: "900", letterSpacing: -0.64 },
  controls: {
    margin: space.list,
    paddingVertical: space.l,
    paddingHorizontal: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    gap: space.l,
  },
  label: { fontSize: 13.5, lineHeight: 18, fontWeight: "700" },
  select: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    height: 52,
    paddingHorizontal: 14,
    borderWidth: comicStroke.control,
    borderRadius: comicRadius.input,
  },
  mono: { fontFamily: font.mono, fontSize: 14 },
  /** “开始”占一整行，下面“模拟断线”“停止”并排（英文的字长，三个并排放不下） */
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.s, paddingBottom: 4 },
  wide: { width: "100%" },
  flex: { flex: 1, paddingHorizontal: space.s },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  inlineBetween: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  tiles: { flexDirection: "row", gap: space.s, marginHorizontal: space.list, marginBottom: space.s },
  tile: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: space.l,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    gap: 2,
  },
  spark: { flex: 0, marginHorizontal: space.list, gap: space.s },
  key: { fontSize: 12 },
  value: { fontFamily: font.monoMedium, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  tail: {
    marginHorizontal: space.list,
    marginTop: space.s,
    paddingVertical: 14,
    paddingHorizontal: space.l,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  report: {
    marginHorizontal: space.list,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    overflow: "hidden",
  },
  verdict: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: space.l,
    borderBottomWidth: comicStroke.chip,
  },
  verdictMark: {
    width: 52,
    height: 52,
    borderRadius: comicRadius.iconButton,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  kv: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: space.l,
  },
  sep: { height: 1.5, marginHorizontal: space.l },
  latency: { paddingVertical: 14, paddingHorizontal: space.l, gap: 10 },
  axis: { height: 12, borderRadius: 6, borderWidth: comicStroke.chip },
  range: { position: "absolute", top: 0, bottom: 0, borderRadius: 6 },
  target: { position: "absolute", top: -4, bottom: -4, width: 3, marginLeft: -1.5, borderRadius: 1.5 },
  axisLabel: { fontFamily: font.mono, fontSize: 10.5 },
  targetLabel: { position: "absolute", marginRight: 4 },
  note: { paddingHorizontal: space.page, paddingVertical: space.s, fontSize: 13, lineHeight: 20 },
});
