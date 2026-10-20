/**
 * 阅读页的 hook：创建 PlaySession，把它的状态接进 React。
 *
 * 流式文字每个片段都会产生一次状态变化，这里用 requestAnimationFrame 合并成每帧最多渲染一次；
 * App 回到前台时让正在重连的事件流立刻重连。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { NewAction, TurnError } from "@bettertavern/core/api/types";
import { diagnostics } from "@bettertavern/core/observability/log";
import { newIdempotencyKey } from "@bettertavern/core/utils/ids";
import { PlaySession } from "@bettertavern/core/play/playSession";
import { initialPlayState, type PlayState } from "@bettertavern/core/play/turnMachine";

import { useApp } from "../../state/AppProvider.tsx";

export type PlayControls = {
  state: PlayState;
  submit: (action: NewAction) => void;
  retry: () => void;
  cancel: () => void;
  dismissError: () => void;
  reload: () => void;
  /** 回到更早的一回合；失败时返回原因 */
  rollback: (turnId: string) => Promise<TurnError | null>;
};

export function usePlaySession(playthroughId: string): PlayControls {
  const { api, connectTurn } = useApp();
  const [state, setState] = useState<PlayState>(initialPlayState);
  const sessionRef = useRef<PlaySession | null>(null);

  useEffect(() => {
    // 在 effect 里创建：开发模式下 effect 会执行两遍，每遍都要有自己的会话
    const session = new PlaySession(playthroughId, {
      api: {
        detail: (id) => api.playthroughs.get(id),
        history: (id, afterSeq, limit) => api.turns.history(id, afterSeq, limit),
        submit: (id, body, key) => api.turns.submit(id, body, key),
        turn: (turnId) => api.turns.get(turnId),
        cancel: (turnId) => api.turns.cancel(turnId),
        rollback: (id, turnId) => api.playthroughs.rollback(id, turnId),
      },
      connect: connectTurn,
      newKey: newIdempotencyKey,
    });
    sessionRef.current = session;
    setState(session.getState());

    let frame: number | null = null;
    let latest = session.getState();
    const unsubscribe = session.subscribe((next) => {
      // 阶段变化记进诊断日志（流式文字的每个片段不记）
      if (next.phase !== latest.phase) {
        diagnostics.log(
          next.phase === "failed" || next.phase === "load_failed" ? "warn" : "info",
          "turn.phase",
          {
            playthrough_id: playthroughId,
            turn_id: next.pending?.turnId ?? null,
            from: latest.phase,
            to: next.phase,
            code: next.error?.code ?? null,
          },
        );
      }
      latest = next;
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          setState(latest);
        });
      }
    });
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") session.resume();
    });
    void session.load();

    return () => {
      unsubscribe();
      appState.remove();
      if (frame !== null) cancelAnimationFrame(frame);
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [playthroughId, api, connectTurn]);

  const submit = useCallback((action: NewAction) => void sessionRef.current?.submit(action), []);
  const retry = useCallback(() => void sessionRef.current?.retry(), []);
  const cancel = useCallback(() => void sessionRef.current?.cancel(), []);
  const dismissError = useCallback(() => sessionRef.current?.dismissError(), []);
  const reload = useCallback(() => void sessionRef.current?.load(), []);
  const rollback = useCallback(
    (turnId: string) => sessionRef.current?.rollback(turnId) ?? Promise.resolve(null),
    [],
  );

  return { state, submit, retry, cancel, dismissError, reload, rollback };
}
