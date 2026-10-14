/**
 * 回合事件流：SSE 消息 → TurnEvent。不认识的事件（以后的版本新增的）直接忽略，保持向前兼容。
 */

import type { SseMessage } from "./sse/sseParser.ts";
import type { TurnEvent } from "./types.ts";

const KNOWN = new Set<string>([
  "turn.created",
  "world.building",
  "world.ready",
  "turn.waiting_state",
  "narrative.delta",
  "narrative.done",
  "options.ready",
  "turn.completed",
  "turn.failed",
  "snapshot",
]);

export function parseTurnEvent(message: SseMessage): TurnEvent | null {
  if (!KNOWN.has(message.event)) return null;
  let data: unknown;
  try {
    data = message.data === "" ? {} : JSON.parse(message.data);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const event = { event: message.event, data } as TurnEvent;
  // 只校验界面直接依赖的字段，其余按服务端契约信任
  switch (event.event) {
    case "narrative.delta":
      return typeof event.data.text === "string" ? event : null;
    case "options.ready":
      return Array.isArray(event.data.options) ? event : null;
    case "turn.completed":
      return typeof event.data.turn === "object" && event.data.turn !== null ? event : null;
    case "snapshot":
      return typeof event.data.narrative === "string"
        ? { ...event, data: { ...event.data, options: event.data.options ?? [] } }
        : null;
    default:
      return event;
  }
}
