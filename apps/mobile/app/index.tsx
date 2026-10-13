/**
 * M0 SSE 探针页：在真机上跑一条 3 分钟的长流，验证中文不乱码、断网续传、延迟。
 * 正式的阅读主屏在 M1 加入（app/play/[id]），这一页届时移到开发者菜单里。
 */

import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { FetchLike } from "../src/api/sse/sseClient.ts";
import {
  DEFAULT_PROBE_CONFIG,
  ProbeSession,
  type ProbeProgress,
  type ProbeReport,
} from "../src/features/probe/probeSession.ts";

const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.1.10:8000";

const streamFetch: FetchLike = (url, init) => expoFetch(url, init);
const jsonFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => fetch(url, init);

export default function ProbeScreen() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_URL);
  const [duration, setDuration] = useState(String(DEFAULT_PROBE_CONFIG.durationS));
  const [progress, setProgress] = useState<ProbeProgress | null>(null);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const session = useRef<ProbeSession | null>(null);
  const pending = useRef<ProbeProgress | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      session.current?.stop();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // 流式文字先存在 ref 里，最多每帧刷新一次界面
  const onProgress = (next: ProbeProgress): void => {
    pending.current = next;
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setProgress(pending.current);
      });
    }
  };

  const start = async (): Promise<void> => {
    setReport(null);
    setError(null);
    const probe = new ProbeSession(baseUrl.trim(), { streamFetch, jsonFetch }, onProgress);
    session.current = probe;
    setRunning(true);
    try {
      const durationS = Math.max(Number(duration) || DEFAULT_PROBE_CONFIG.durationS, 5);
      setReport(await probe.run({ ...DEFAULT_PROBE_CONFIG, durationS }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      session.current = null;
      setRunning(false);
    }
  };

  const tail = progress ? [...progress.text].slice(-300).join("") : "";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>SSE 探针（M0）</Text>
      <Text style={styles.label}>服务端地址</Text>
      <TextInput
        style={styles.input}
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.label}>时长（秒）</Text>
      <TextInput style={styles.input} value={duration} onChangeText={setDuration} keyboardType="number-pad" />
      <View style={styles.row}>
        <Button title="开始" onPress={start} disabled={running} />
        <Button title="模拟断线" onPress={() => session.current?.dropConnection()} disabled={!running} />
        <Button title="停止" onPress={() => session.current?.stop()} disabled={!running} />
      </View>
      {progress && (
        <Text style={styles.stats}>
          状态 {progress.state}　事件 {progress.events}　重连 {progress.reconnects}　最近延迟{" "}
          {progress.lastLatencyMs === null ? "-" : `${Math.round(progress.lastLatencyMs)} 毫秒`}
        </Text>
      )}
      {tail.length > 0 && <Text style={styles.text}>{tail}</Text>}
      {report && (
        <View style={styles.report}>
          <Text style={[styles.verdict, report.passed ? styles.pass : styles.fail]}>
            {report.passed ? "通过" : "未通过"}
          </Text>
          <Text>方式：{report.mode === "sse" ? "SSE" : "轮询降级"}</Text>
          <Text>
            字数：{report.chars}　事件：{report.events}　重连：{report.reconnects}
          </Text>
          <Text>
            文本一致：{report.integrityOk ? "是" : "否"}　重复或缺失：{report.duplicateOrMissing}
          </Text>
          <Text>
            延迟 p50 / p95：{report.latencyP50Ms ?? "-"} / {report.latencyP95Ms ?? "-"} 毫秒（目标 p95 &lt;
            300）
          </Text>
          <Text>续传补发的积压事件：{report.backlogEvents} 个（不计入延迟）</Text>
          <Text>时钟偏差估计：{report.clockOffsetMs} 毫秒</Text>
        </View>
      )}
      {error && <Text style={styles.fail}>出错：{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  title: { fontSize: 20, fontWeight: "600" },
  label: { marginTop: 8, color: "#666" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", marginVertical: 8 },
  stats: { fontVariant: ["tabular-nums"] },
  text: { marginTop: 8, lineHeight: 22 },
  report: { marginTop: 12, gap: 4 },
  verdict: { fontSize: 18, fontWeight: "600" },
  pass: { color: "#1a7f37" },
  fail: { color: "#cf222e" },
});
