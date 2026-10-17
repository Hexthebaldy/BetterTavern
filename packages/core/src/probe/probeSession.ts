/**
 * M0 SSE 探针的会话逻辑（与界面无关，Node 里也能跑）。
 *
 * 验收标准：iOS 与 Android 真机，Wi-Fi 与蜂窝网络，各跑一次 3 分钟以上的长流；中文无乱码；
 * 中途断网再恢复后用 Last-Event-ID 续传，拼出的文本与最终叙述一致；
 * 服务端发出到屏幕上出现的延迟 p95 小于 300 毫秒。
 */

import { SseClient, type FetchLike, type SseClientState } from "../api/sse/sseClient.ts";
import type { SseMessage } from "../api/sse/sseParser.ts";

export type ProbeConfig = {
  durationS: number;
  eventsPerSecond: number;
  charsPerEvent: number;
};

export const DEFAULT_PROBE_CONFIG: ProbeConfig = { durationS: 180, eventsPerSecond: 20, charsPerEvent: 8 };

export type ProbeProgress = {
  state: SseClientState;
  text: string;
  events: number;
  reconnects: number;
  lastLatencyMs: number | null;
};

export type ProbeReport = {
  streamId: string;
  mode: "sse" | "polling";
  chars: number;
  events: number;
  reconnects: number;
  /** 续传补发的积压事件数（不计入延迟） */
  backlogEvents: number;
  duplicateOrMissing: number;
  integrityOk: boolean;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  clockOffsetMs: number;
  durationMs: number;
  passed: boolean;
};

type JsonFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type ProbeDeps = {
  /** 支持流式 body 的 fetch（App 里是 expo/fetch） */
  streamFetch: FetchLike;
  /** 普通 JSON 请求用的 fetch */
  jsonFetch: JsonFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const LATENCY_TARGET_MS = 300;
// 时钟偏差估计的误差容忍（往返时间的一半量级）
const CLOCK_TOLERANCE_MS = 100;
const STATUS_RETRIES = 40;

export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(Math.round(q * (sorted.length - 1)), sorted.length - 1);
  return sorted[index] ?? null;
}

/** 类 NTP 的一次往返：offset = 服务端时间 − 本机往返中点。 */
export async function measureClockOffset(baseUrl: string, deps: ProbeDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const samples: { rtt: number; offset: number }[] = [];
  for (let i = 0; i < 3; i += 1) {
    const sent = now();
    const response = await deps.jsonFetch(`${baseUrl}/v1/probe/time`);
    const received = now();
    const body = (await response.json()) as { server_time_ms: number };
    samples.push({ rtt: received - sent, offset: body.server_time_ms - (sent + received) / 2 });
  }
  samples.sort((a, b) => a.rtt - b.rtt);
  return samples[0]?.offset ?? 0; // 取往返最短的一次，误差最小
}

export class ProbeSession {
  private readonly baseUrl: string;
  private readonly deps: ProbeDeps;
  private readonly onProgress: (progress: ProbeProgress) => void;
  private client: SseClient | null = null;
  private stopped = false;

  constructor(
    baseUrl: string,
    deps: ProbeDeps,
    onProgress: (progress: ProbeProgress) => void = () => undefined,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.deps = deps;
    this.onProgress = onProgress;
  }

  /** 模拟断网：断开当前连接，客户端会带 Last-Event-ID 自动重连。 */
  dropConnection(): void {
    this.client?.dropConnection();
  }

  stop(): void {
    this.stopped = true;
    this.client?.close();
  }

  async run(config: ProbeConfig = DEFAULT_PROBE_CONFIG): Promise<ProbeReport> {
    const now = this.deps.now ?? Date.now;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const started = now();
    const offset = await measureClockOffset(this.baseUrl, this.deps);
    const created = await this.deps.jsonFetch(`${this.baseUrl}/v1/probe/streams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        duration_s: config.durationS,
        events_per_second: config.eventsPerSecond,
        chars_per_event: config.charsPerEvent,
      }),
    });
    if (!created.ok) throw new Error(`Failed to create probe: HTTP ${created.status}`);
    const info = (await created.json()) as { stream_id: string; events_url: string; status_url: string };

    let text = "";
    let events = 0;
    let lastSeq = 0;
    let anomalies = 0;
    let lastLatency: number | null = null;
    const latencies: number[] = [];
    let backlogEvents = 0;
    // 每次连上时的服务端时间：在这之前发出的事件是续传补发的积压，不计入延迟
    let openedAtServerMs: number | null = null;
    let state: SseClientState = "idle";
    const report = (): void =>
      this.onProgress({
        state,
        text,
        events,
        reconnects: this.client?.reconnectCount ?? 0,
        lastLatencyMs: lastLatency,
      });

    const onEvent = (message: SseMessage): void => {
      const seq = message.id ? Number(message.id.slice(message.id.lastIndexOf(":") + 1)) : NaN;
      if (Number.isFinite(seq)) {
        if (seq !== lastSeq + 1) anomalies += 1; // 续传后应当不重不漏
        lastSeq = seq;
      }
      if (message.event === "narrative.delta") {
        const payload = JSON.parse(message.data) as { text: string; sent_at: number };
        text += payload.text;
        events += 1;
        const latency = now() + offset - payload.sent_at;
        if (openedAtServerMs !== null && payload.sent_at >= openedAtServerMs - CLOCK_TOLERANCE_MS) {
          lastLatency = latency;
          latencies.push(latency);
        } else {
          backlogEvents += 1;
        }
        report();
      }
    };

    this.client = new SseClient({
      url: `${this.baseUrl}${info.events_url}`,
      fetch: this.deps.streamFetch,
      onEvent,
      onStateChange: (next) => {
        state = next;
        if (next === "open") openedAtServerMs = now() + offset;
        report();
      },
    });
    let outcome = await this.client.run();
    let mode: ProbeReport["mode"] = "sse";

    // 断网时查询状态也会失败：每 1.5 秒重试，最多约 1 分钟
    const status = async (): Promise<{ status: string; text?: string; sha256: string }> => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const response = await this.deps.jsonFetch(`${this.baseUrl}${info.status_url}`);
          if (!response.ok) throw new Error(`Failed to read probe status: HTTP ${response.status}`);
          return (await response.json()) as { status: string; text?: string; sha256: string };
        } catch (error) {
          if (this.stopped || attempt >= STATUS_RETRIES) throw error;
          await sleep(1500);
        }
      }
    };
    let final = await status();
    if (outcome === "polling") {
      // 轮询降级：每 1.5 秒查一次，直到结束
      mode = "polling";
      while (final.status === "running" && !this.stopped) {
        await sleep(1500);
        final = await status();
      }
      text = final.text ?? text;
      outcome = final.status === "completed" ? "completed" : "closed";
    }
    const integrityOk = outcome === "completed" && final.text !== undefined && final.text === text;
    const p95 = percentile(latencies, 0.95);
    return {
      streamId: info.stream_id,
      mode,
      chars: [...text].length,
      events,
      reconnects: this.client.reconnectCount,
      backlogEvents,
      duplicateOrMissing: anomalies,
      integrityOk,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: p95,
      clockOffsetMs: Math.round(offset),
      durationMs: now() - started,
      passed: integrityOk && mode === "sse" && anomalies === 0 && p95 !== null && p95 < LATENCY_TARGET_MS,
    };
  }
}
