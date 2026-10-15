/**
 * 连接测试（M0 的 SSE 探针）：在真机上跑一条长流，验证中文不乱码、断网续传、延迟。
 * 登录前后都能打开，用来排查服务器地址、代理缓冲之类的问题。验收标准见 docs/client.md（要跑 3 分钟以上，选 5m）。
 * 路由页面是 app/dev/probe.tsx；宽屏设置两栏时嵌在右栏里（见 ../settings/nav.tsx）。
 */

import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { font, onColor, space, usePalette } from "../../theme/index.ts";

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
  const palette = usePalette();
  const height = 60;
  const max = Math.max(TARGET_MS * 1.3, ...values);
  const y = (v: number): number => height - 6 - (v / max) * (height - 14);
  const step = width / (SPARK_POINTS - 1);
  const offset = SPARK_POINTS - values.length;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${(offset + i) * step} ${y(v)}`).join("");
  const peak = values.length > 0 ? values.indexOf(Math.max(...values)) : -1;
  return (
    <Svg width={width} height={height} accessibilityLabel="延迟走势">
      <Path
        d={`M0 ${y(TARGET_MS)}H${width}`}
        stroke={palette.err}
        strokeWidth={1.5}
        strokeDasharray="2 5"
        strokeLinecap="round"
      />
      <SvgText x={width} y={y(TARGET_MS) - 4} textAnchor="end" fontSize={9} fill={palette.err}>
        300ms
      </SvgText>
      {path ? (
        <Path
          d={path}
          stroke={palette.ink}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : null}
      {peak >= 0 && (values[peak] ?? 0) > TARGET_MS ? (
        <Circle cx={(offset + peak) * step} cy={y(values[peak] ?? 0)} r={4.5} fill={palette.warn} />
      ) : null}
    </Svg>
  );
}

function ReportView({ report, duration }: { report: ProbeReport; duration: number }) {
  const palette = usePalette();
  const tone = report.passed ? palette.ok : palette.err;
  const row = (label: string, value: ReactNode) => (
    <View style={styles.kv}>
      <Text style={{ fontSize: 14, color: palette.ink }}>{label}</Text>
      {typeof value === "string" ? <Text style={[styles.mono, { color: palette.ink }]}>{value}</Text> : value}
    </View>
  );
  const sep = <View style={[styles.sep, { backgroundColor: palette.bg }]} />;
  const scale = 400;
  const p50 = report.latencyP50Ms ?? 0;
  const p95 = report.latencyP95Ms ?? 0;
  const pct = (v: number): `${number}%` => `${Math.min(v / scale, 1) * 100}%`;
  return (
    <View>
      <SectionHeader
        title="报告"
        meta={`上一次 · ${DURATIONS.find((d) => Number(d.value) === duration)?.label ?? `${duration}s`}`}
      />
      <View style={[styles.report, { backgroundColor: palette.bg2 }]}>
        <View style={[styles.verdict, { backgroundColor: report.passed ? palette.okBg : palette.errBg }]}>
          <View style={[styles.verdictMark, { backgroundColor: tone }]}>
            <Icon name={report.passed ? "check" : "cross"} size={26} color={onColor} strokeWidth={2.4} />
          </View>
          <View>
            <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: "900", color: palette.ink }}>
              {report.passed ? "通过" : "未通过"}
            </Text>
            <Text style={{ fontSize: 13, color: palette.ink2 }}>
              断线 {report.reconnects} 次，{report.integrityOk ? "续传完整" : "文本不一致"}
            </Text>
          </View>
        </View>
        {row("模式", report.mode === "sse" ? "SSE" : "轮询降级")}
        {report.mode === "polling" ? (
          <Text style={[styles.note, { color: palette.warn }]}>
            这一跳可能在缓冲 SSE（反向代理或网关），事件流被降级成了轮询。
          </Text>
        ) : null}
        {sep}
        {row("字符数", report.chars.toLocaleString("en-US"))}
        {sep}
        {row(
          "完整性",
          <View style={styles.inline}>
            <Icon name={report.integrityOk ? "check" : "cross"} size={15} color={tone} strokeWidth={2.2} />
            <Text style={{ fontSize: 14, color: tone }}>{report.integrityOk ? "完整" : "不完整"}</Text>
          </View>,
        )}
        {sep}
        {row("重复或缺失", String(report.duplicateOrMissing))}
        {sep}
        <View style={styles.latency}>
          <View style={styles.inlineBetween}>
            <Text style={{ fontSize: 14, color: palette.ink }}>延迟</Text>
            <Text style={[styles.mono, { color: palette.ink }]}>
              p50 {report.latencyP50Ms ?? "-"} · p95 {report.latencyP95Ms ?? "-"} ms
            </Text>
          </View>
          <View
            style={[styles.axis, { backgroundColor: palette.card }]}
            accessibilityLabel={`p50 ${p50} 毫秒，p95 ${p95} 毫秒，目标低于 300 毫秒`}
          >
            <View
              style={[
                styles.range,
                { left: pct(p50), width: pct(Math.max(p95 - p50, 6)), backgroundColor: palette.ink },
              ]}
            />
            <View style={[styles.target, { left: pct(TARGET_MS), backgroundColor: palette.err }]} />
          </View>
          <View style={styles.inlineBetween}>
            <Text style={[styles.axisLabel, { color: palette.mut }]}>0</Text>
            {/* 目标线的说明对准目标线，右端对齐 */}
            <Text
              style={[
                styles.axisLabel,
                styles.targetLabel,
                { right: pct(scale - TARGET_MS), color: palette.err },
              ]}
            >
              目标 {TARGET_MS}
            </Text>
            <Text style={[styles.axisLabel, { color: palette.mut }]}>{scale}ms</Text>
          </View>
        </View>
        {sep}
        {row("续传补发的积压", String(report.backlogEvents))}
        {sep}
        {row("时钟偏差", `${report.clockOffsetMs >= 0 ? "+" : ""}${report.clockOffsetMs} ms`)}
      </View>
    </View>
  );
}

/** url：要测的服务器（登录页的服务器设置会带过来）；不传就测当前的服务器 */
export function ProbeBody({ url }: { url?: string }) {
  const { serverUrl } = useApp();
  const palette = usePalette();
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
        <Pill label="开发者工具" tone="grey" height={26} />
        <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
          连接测试
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 22, color: palette.mut }}>
          模拟一次长时间的流式输出，检查断线续传是否完整、延迟是否够低。服务端要开启探针接口（ENABLE_PROBE_ENDPOINTS）。
        </Text>
      </View>

      <View style={[styles.controls, { backgroundColor: palette.bg2 }]}>
        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: palette.ink2 }]}>服务器</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`服务器 ${displayServer(baseUrl)}，更改`}
            disabled={running}
            onPress={() => setPicking(true)}
            style={[styles.select, { backgroundColor: palette.card, opacity: running ? 0.3 : 1 }]}
          >
            <Icon name="server" size={18} />
            <Text numberOfLines={1} style={[styles.mono, { flex: 1, color: palette.ink }]}>
              {displayServer(baseUrl)}
            </Text>
            <Icon name="chevronDown" size={18} />
          </Pressable>
        </View>
        <Segmented
          label="测试时长"
          value={duration}
          options={DURATIONS}
          onChange={setDuration}
          mono
          height={52}
        />
        <View style={styles.buttons}>
          <Button
            label="开始"
            icon="play"
            onPress={() => void start()}
            disabled={running}
            style={styles.flex}
          />
          <Button
            label="模拟断线"
            icon="disconnect"
            variant="secondary"
            onGrey
            onPress={() => session.current?.dropConnection()}
            disabled={!running}
            style={styles.flex}
          />
          <Button
            label="停止"
            icon="stop"
            variant={running ? "primary" : "secondary"}
            onGrey
            onPress={() => session.current?.stop()}
            disabled={!running}
            style={styles.flex}
          />
        </View>
      </View>

      {progress ? (
        <>
          <SectionHeader
            title="实时"
            meta={
              <Pill
                tone={liveTone}
                dot={running}
                height={28}
                label={
                  <>
                    {running
                      ? live
                        ? "接收中"
                        : progress.state === "polling"
                          ? "轮询中"
                          : "重连中"
                      : "已结束"}{" "}
                    · <Text style={{ fontFamily: font.mono }}>{clock(elapsed)}</Text>
                  </>
                }
              />
            }
          />
          <View style={styles.tiles}>
            <View style={[styles.tile, { backgroundColor: palette.bg2 }]}>
              <Text style={[styles.key, { color: palette.mut }]}>事件数</Text>
              <Text style={[styles.value, { color: palette.ink }]}>
                {progress.events.toLocaleString("en-US")}
              </Text>
            </View>
            <View style={[styles.tile, { backgroundColor: palette.bg2 }]}>
              <Text style={[styles.key, { color: palette.mut }]}>重连次数</Text>
              <Text style={[styles.value, { color: palette.ink }]}>{progress.reconnects}</Text>
            </View>
          </View>
          <View
            style={[styles.tile, styles.spark, { backgroundColor: palette.bg2 }]}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width - space.l * 2)}
          >
            <View style={styles.inlineBetween}>
              <Text style={[styles.key, { color: palette.mut }]}>最近延迟</Text>
              <Text style={[styles.mono, { fontSize: 20, color: palette.ink }]}>
                {progress.lastLatencyMs === null ? "-" : Math.round(progress.lastLatencyMs)}{" "}
                <Text style={{ fontSize: 12, color: palette.mut }}>ms</Text>
              </Text>
            </View>
            <Spark values={latencies} width={width} />
          </View>
          {tail.length > 0 ? (
            <View style={[styles.tail, { backgroundColor: palette.bg2 }]}>
              <Text style={[styles.key, { color: palette.mut, marginBottom: 6 }]}>最近 300 字</Text>
              <Text style={[styles.mono, { fontSize: 12, lineHeight: 19, color: palette.ink2 }]}>
                {tail}
                {running ? <Text style={{ color: palette.acc }}>▍</Text> : null}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      {report ? <ReportView report={report.report} duration={report.duration} /> : null}
      {error ? <Text style={[styles.note, { color: palette.err }]}>出错：{error}</Text> : null}
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
  big: { fontSize: 32, lineHeight: 40, fontWeight: "700", letterSpacing: -0.64 },
  controls: {
    margin: space.list,
    paddingVertical: space.l,
    paddingHorizontal: space.m,
    borderRadius: 30,
    gap: space.l,
  },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500", paddingLeft: space.xs },
  select: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    height: 52,
    paddingHorizontal: space.l,
    borderRadius: 16,
  },
  mono: { fontFamily: font.mono, fontSize: 14 },
  buttons: { flexDirection: "row", gap: 6 },
  flex: { flex: 1, paddingHorizontal: space.s },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  inlineBetween: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  tiles: { flexDirection: "row", gap: 6, marginHorizontal: space.list, marginBottom: 6 },
  tile: { flex: 1, paddingVertical: 14, paddingHorizontal: space.l, borderRadius: 24, gap: 2 },
  spark: { flex: 0, marginHorizontal: space.list, gap: space.s },
  key: { fontSize: 12 },
  value: { fontFamily: font.monoMedium, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  tail: {
    marginHorizontal: space.list,
    marginTop: 6,
    paddingVertical: 14,
    paddingHorizontal: space.l,
    borderRadius: 24,
  },
  report: { marginHorizontal: space.list, borderRadius: 30, overflow: "hidden" },
  verdict: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: space.l,
  },
  verdictMark: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  kv: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: space.l,
  },
  sep: { height: 1.5, marginHorizontal: space.l },
  latency: { paddingVertical: 14, paddingHorizontal: space.l, gap: 10 },
  axis: { height: 12, borderRadius: 6 },
  range: { position: "absolute", top: 0, bottom: 0, borderRadius: 6 },
  target: { position: "absolute", top: -4, bottom: -4, width: 3, marginLeft: -1.5, borderRadius: 1.5 },
  axisLabel: { fontFamily: font.mono, fontSize: 10.5 },
  targetLabel: { position: "absolute", marginRight: 4 },
  note: { paddingHorizontal: space.page, paddingVertical: space.s, fontSize: 13, lineHeight: 20 },
});
