/**
 * 连接测试（M0 的 SSE 探针）：在真机上跑一条长流，验证中文不乱码、断网续传、延迟。
 * 登录前后都能打开，用来排查服务器地址、代理缓冲之类的问题。验收标准见 docs/client.md。
 */

import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Body, Button, Caption, Field, Page } from "../../src/components/ui.tsx";
import type { FetchLike } from "../../src/api/sse/sseClient.ts";
import {
  DEFAULT_PROBE_CONFIG,
  ProbeSession,
  type ProbeProgress,
  type ProbeReport,
} from "../../src/features/probe/probeSession.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, type, usePalette } from "../../src/theme/index.ts";

const streamFetch: FetchLike = (url, init) => expoFetch(url, init);
const jsonFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => fetch(url, init);

export default function ProbeScreen() {
  const { serverUrl } = useApp();
  const palette = usePalette();
  const [baseUrl, setBaseUrl] = useState(serverUrl);
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
  const good = { color: palette.accent };
  const bad = { color: palette.danger };

  return (
    <Page>
      <Caption style={{ marginBottom: space.l }}>
        服务端需要开启探针接口（开发环境默认开启，生产环境设置
        ENABLE_PROBE_ENDPOINTS=true）。跑到一半点“模拟断线”，或者切到飞行模式再切回来。
      </Caption>
      <Field
        label="服务端地址"
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Field label="时长（秒）" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
      <View style={styles.row}>
        <Button label="开始" onPress={start} busy={running} style={styles.flex} />
        <Button
          label="模拟断线"
          variant="secondary"
          onPress={() => session.current?.dropConnection()}
          disabled={!running}
          style={styles.flex}
        />
        <Button
          label="停止"
          variant="secondary"
          onPress={() => session.current?.stop()}
          disabled={!running}
          style={styles.flex}
        />
      </View>
      {progress ? (
        <Caption style={styles.stats}>
          状态 {progress.state}　事件 {progress.events}　重连 {progress.reconnects}　最近延迟{" "}
          {progress.lastLatencyMs === null ? "-" : `${Math.round(progress.lastLatencyMs)} 毫秒`}
        </Caption>
      ) : null}
      {tail.length > 0 ? <Body style={styles.text}>{tail}</Body> : null}
      {report ? (
        <View style={styles.report}>
          <Text style={[type.heading, report.passed ? good : bad]}>{report.passed ? "通过" : "未通过"}</Text>
          <Body>方式：{report.mode === "sse" ? "SSE" : "轮询降级（这一跳可能在缓冲 SSE）"}</Body>
          <Body>
            字数：{report.chars}　事件：{report.events}　重连：{report.reconnects}
          </Body>
          <Body>
            文本一致：{report.integrityOk ? "是" : "否"}　重复或缺失：{report.duplicateOrMissing}
          </Body>
          <Body>
            延迟 p50 / p95：{report.latencyP50Ms ?? "-"} / {report.latencyP95Ms ?? "-"} 毫秒（目标 p95 &lt;
            300）
          </Body>
          <Body>续传补发的积压事件：{report.backlogEvents} 个（不计入延迟）</Body>
          <Body>时钟偏差估计：{report.clockOffsetMs} 毫秒</Body>
        </View>
      ) : null}
      {error ? <Body style={[styles.text, bad]}>出错：{error}</Body> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.s, marginBottom: space.l },
  flex: { flex: 1, paddingHorizontal: space.s },
  stats: { fontVariant: ["tabular-nums"] },
  text: { marginTop: space.s },
  report: { marginTop: space.l, gap: space.xs },
});
