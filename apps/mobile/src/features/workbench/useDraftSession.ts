/**
 * 一份草稿的页面状态（同网页端 pages/workbench/useDraftSession.ts）：
 * 先读草稿和对话记录，再从对话记录给的事件编号之后订阅推送事件（SSE），事件经 @bettertavern/core 的
 * workbench/session.ts 合进状态；草稿变了（draft 事件、一轮结束）就重新读一次草稿。
 * SSE 转成轮询（中间的代理在缓冲）时每 3 秒重新读草稿和对话记录。
 *
 * 动作：说话、交问卷、回复方案、对改动做决定、停止、接着写、切模式、保存进仓库。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { SaveOptions } from "@bettertavern/core/api/endpoints";
import type { Draft, DraftMode, DraftSave, NewMessage } from "@bettertavern/core/api/types";
import {
  applyEvent,
  initialState,
  upsertMessage,
  withDraft,
  type WorkbenchState,
} from "@bettertavern/core/workbench/session";

import { useApp } from "../../state/AppProvider.tsx";

const POLL_MS = 3000;

export type Decision = { accept?: string[]; reject?: string[]; all?: "accept" | "reject" };

export type DraftSession = {
  state: WorkbenchState | null;
  error: unknown;
  reload: () => Promise<void>;
  /** 换上服务端返回的新草稿（自动保存、换封面之后） */
  setDraft: (draft: Draft) => void;
  send: (message: NewMessage) => Promise<void>;
  decide: (seq: number, body: Decision) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => Promise<void>;
  setMode: (mode: DraftMode) => Promise<void>;
  save: (options?: SaveOptions) => Promise<DraftSave>;
};

export function useDraftSession(draftId: string): DraftSession {
  const { api, connectWorkbench } = useApp();
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refreshing = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [draft, transcript] = await Promise.all([api.workbench.get(draftId), api.workbench.messages(draftId)]);
      setState(initialState(draft, transcript.messages));
      return transcript.last_event_id;
    } catch (e) {
      setError(e);
      return null;
    }
  }, [api, draftId]);

  const refreshDraft = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const draft = await api.workbench.get(draftId);
      setState((s) => (s ? withDraft(s, draft) : s));
    } catch {
      // 下次事件再试
    } finally {
      refreshing.current = false;
    }
  }, [api, draftId]);

  useEffect(() => {
    let closed = false;
    let stream: { close(): void } | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const last = await load();
      if (closed || last === null) return;
      const connection = connectWorkbench(draftId, {
        lastEventId: String(last),
        onEvent: (event) => setState((s) => (s ? applyEvent(s, event) : s)),
        onState: (mode) => {
          if (mode === "polling" && !poll) {
            poll = setInterval(() => {
              void Promise.all([api.workbench.get(draftId), api.workbench.messages(draftId)]).then(
                ([draft, transcript]) =>
                  setState((s) => {
                    if (!s) return s;
                    let next = withDraft(s, draft);
                    for (const m of transcript.messages) next = { ...next, messages: upsertMessage(next.messages, m) };
                    return next;
                  }),
                () => undefined,
              );
            }, POLL_MS);
          }
        },
      });
      stream = connection;
      void connection.run();
    })();
    return () => {
      closed = true;
      stream?.close();
      if (poll) clearInterval(poll);
    };
  }, [api, connectWorkbench, draftId, load]);

  const needsRefresh = state?.needsRefresh ?? false;
  useEffect(() => {
    if (needsRefresh) void refreshDraft();
  }, [needsRefresh, refreshDraft]);

  const setDraft = useCallback((draft: Draft) => {
    setState((s) => (s ? withDraft(s, draft) : s));
  }, []);

  const send = useCallback(
    async (message: NewMessage) => {
      const created = await api.workbench.post(draftId, message);
      setState((s) =>
        s ? { ...s, messages: upsertMessage(s.messages, created), agentStatus: "running", awaiting: null } : s,
      );
    },
    [api, draftId],
  );

  const decide = useCallback(
    async (seq: number, body: Decision) => {
      const result = await api.workbench.decide(draftId, seq, body);
      setState((s) => (s ? withDraft({ ...s, messages: upsertMessage(s.messages, result.message) }, result.draft) : s));
    },
    [api, draftId],
  );

  const stop = useCallback(async () => {
    await api.workbench.stop(draftId);
  }, [api, draftId]);

  const resume = useCallback(async () => {
    setDraft(await api.workbench.continue(draftId));
  }, [api, draftId, setDraft]);

  const setMode = useCallback(
    async (mode: DraftMode) => {
      setDraft(await api.workbench.setMode(draftId, mode));
    },
    [api, draftId, setDraft],
  );

  const save = useCallback(
    async (options?: SaveOptions) => {
      const result = await api.workbench.save(draftId, options);
      setDraft(result.draft);
      return result;
    },
    [api, draftId, setDraft],
  );

  return { state, error, reload: async () => void (await load()), setDraft, send, decide, stop, resume, setMode, save };
}
