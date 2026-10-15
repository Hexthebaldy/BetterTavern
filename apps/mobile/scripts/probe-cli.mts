/**
 * 在电脑上用 Node 跑一遍 SSE 探针（与 App 里的探针页同一套逻辑），用来先排除服务端和代理的问题。
 *
 *   node --experimental-strip-types scripts/probe-cli.mts http://localhost:8000 20
 *
 * 第二个参数是时长（秒）；跑到 40% 时会主动断开一次连接，验证 Last-Event-ID 续传。
 */

import { DEFAULT_PROBE_CONFIG, ProbeSession } from "@bettertavern/core/probe/probeSession";
import type { FetchLike } from "@bettertavern/core/api/sse/sseClient";

const baseUrl = process.argv[2] ?? "http://localhost:8000";
const durationS = Number(process.argv[3] ?? 20);

const streamFetch: FetchLike = (url, init) => fetch(url, init);
const jsonFetch = (url: string, init?: RequestInit) => fetch(url, init);

let lastPrinted = 0;
const session = new ProbeSession(baseUrl, { streamFetch, jsonFetch }, (progress) => {
  if (progress.events - lastPrinted >= 50 || progress.state !== "open") {
    lastPrinted = progress.events;
    console.log(
      `[${progress.state}] 事件 ${progress.events}，重连 ${progress.reconnects}，最近延迟 ${progress.lastLatencyMs ?? "-"} 毫秒`,
    );
  }
});

const drop = setTimeout(() => {
  console.log("—— 主动断开一次连接 ——");
  session.dropConnection();
}, durationS * 400);

const report = await session.run({ ...DEFAULT_PROBE_CONFIG, durationS });
clearTimeout(drop);
console.log(JSON.stringify(report, null, 2));
console.log(report.passed ? "通过" : "未通过");
process.exit(report.passed ? 0 : 1);
