/**
 * Agent 模式的左栏（W02–W05，同 App 的 src/features/workbench/AgentPane.tsx）：对话记录，正在发生的事
 * （agent 正在说的话、正在用的工具、进度清单和“停止”），底下是建议和输入框。
 * - 输入框里 Enter 发送、Shift+Enter 换行；agent 在跑时不能发（DRAFT_BUSY），在等回答时可以直接说话；
 * - 上一轮被停下、出错、没写完，或者手动开始的草稿还没让 agent 动过手：显示“接着写完”；
 * - 新内容出来时，看的是最底下就跟着滚到底，往上翻着看时不打扰。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Asset, NewMessage, WorkbenchMessage } from "@bettertavern/core/api/types";
import { canTalk } from "@bettertavern/core/workbench/progress";
import { awaitedMessage, type WorkbenchState } from "@bettertavern/core/workbench/session";
import { toolLabel, writingLabel } from "@bettertavern/core/workbench/labels";

import { Button, cx, Dots, IconButton } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import styles from "./chat.module.css";
import { AgentRow, MessageView, type MessageActions } from "./Messages.tsx";
import type { DraftSession } from "./useDraftSession.ts";

/** 最后一条说明上一轮没做完：出错、被停下、没写完 */
function unfinished(state: WorkbenchState): boolean {
  const last = state.messages.at(-1);
  // 还没让 agent 动过手的草稿：没写完才“接着写完”（从仓库打开的、写好的卡只能提要求）
  if (!last) return state.draft.draft.origin !== "agent" && state.stage !== "done" && state.stage !== "revise";
  if (last.kind === "error") return true;
  if (last.kind === "progress") return last.content.stopped || !last.content.complete;
  return false;
}

function Todos({ state, stopping, onStop }: { state: WorkbenchState; stopping: boolean; onStop: () => void }) {
  const { t } = useTranslation();
  const done = state.todos.filter((todo) => todo.state === "done").length;
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>
          <Icon name="write" size={14} />
          {t("workbench.status.running")}
          <span className={styles.cardMeta}>
            {done} / {state.todos.length}
          </span>
        </span>
        <Button
          label={stopping ? t("workbench.chat.stopping") : t("workbench.chat.stop")}
          icon="stop"
          variant="secondary"
          size="sm"
          disabled={stopping}
          onClick={onStop}
        />
      </div>
      <div className={styles.todos}>
        {state.todos.map((todo) => (
          <div
            key={todo.key}
            className={cx(
              styles.todo,
              todo.state === "done" && styles.todoDone,
              todo.state === "doing" && styles.todoDoing,
            )}
          >
            <span className={styles.todoMark}>{todo.state === "done" ? <Icon name="check" size={11} /> : null}</span>
            <span className={styles.todoText}>
              <span>{todo.text}</span>
              {todo.detail ? <span className={styles.todoDetail}>{todo.detail}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** agent 正在跑时的那一块：正在说的话、工具、正在写的地方、进度清单 */
function Live({ state, stopping, onStop }: { state: WorkbenchState; stopping: boolean; onStop: () => void }) {
  const { t } = useTranslation();
  // 正在写某个字段时说清楚是哪一个；查资料、出图时说在用什么工具
  const writingTool = !state.tool || state.tool.name === "write_field" || state.tool.name === "lore_upsert";
  const working =
    state.writing && writingTool
      ? writingLabel(state.writing.target)
      : state.tool
        ? toolLabel(state.tool)
        : null;
  return (
    <AgentRow>
      {state.speaking ? <div className={cx(styles.agentText, styles.caret)}>{state.speaking}</div> : null}
      {working || !state.speaking ? (
        <div className={styles.toolLine}>
          <Dots label={working ?? t("workbench.chat.thinking")} />
          <span>{working ?? t("workbench.chat.thinking")}</span>
        </div>
      ) : null}
      {state.todos.length ? (
        <Todos state={state} stopping={stopping} onStop={onStop} />
      ) : (
        <div>
          <Button
            label={stopping ? t("workbench.chat.stopping") : t("workbench.chat.stop")}
            icon="stop"
            variant="secondary"
            size="sm"
            disabled={stopping}
            onClick={onStop}
          />
        </div>
      )}
    </AgentRow>
  );
}

export function AgentPane({
  session,
  state,
  pickCover,
}: {
  session: DraftSession;
  state: WorkbenchState;
  pickCover: (asset: Asset) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const overlay = useOverlay();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [resuming, setResuming] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const running = state.agentStatus === "running";
  const { send, decide, stop, resume } = session;

  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const report = useCallback(
    (e: unknown) => {
      const message = e instanceof ApiError && e.code === "DRAFT_BUSY" ? t("workbench.chat.busy") : describeError(e);
      overlay.toast(message, { icon: "alert" });
    },
    [overlay, t],
  );

  const post = useCallback(
    async (message: NewMessage) => {
      pinned.current = true;
      try {
        await send(message);
      } catch (e) {
        report(e);
        throw e;
      }
    },
    [report, send],
  );

  const messagesBySeq = useMemo(() => new Map(state.messages.map((m) => [m.seq, m])), [state.messages]);
  const awaited = awaitedMessage(state);
  const actions = useMemo<MessageActions>(
    () => ({
      awaitedSeq: awaited?.seq ?? null,
      assets: state.draft.assets,
      coverAssetId: state.draft.cover_asset_id,
      find: (seq) => messagesBySeq.get(seq),
      answer: (answers, delegated) => post({ kind: "answers", answers, delegated }).catch(() => undefined),
      replyPlan: (reply) => post({ kind: "plan_reply", ...reply }).catch(() => undefined),
      decide: async (seq, decision) => {
        pinned.current = true;
        await decide(seq, decision);
      },
      pickCover,
    }),
    [awaited?.seq, state.draft.assets, state.draft.cover_asset_id, messagesBySeq, post, decide, pickCover],
  );

  // 看的是最底下就跟着滚
  const onScroll = (): void => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.speaking, state.todos, state.tool, running]);

  const submit = async (): Promise<void> => {
    const value = text.trim();
    if (!value || sending || !canTalk(state.agentStatus)) return;
    setSending(true);
    try {
      await post({ kind: "text", text: value });
      setText("");
    } catch {
      // 已经提示过
    } finally {
      setSending(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const onStop = (): void => {
    setStopping(true);
    stop().catch((e: unknown) => {
      setStopping(false);
      report(e);
    });
  };

  const onResume = async (): Promise<void> => {
    setResuming(true);
    pinned.current = true;
    try {
      await resume();
    } catch (e) {
      report(e);
    } finally {
      setResuming(false);
    }
  };

  const finished = state.stage === "done" || state.stage === "revise";
  const placeholder = running
    ? t("workbench.chat.placeholderRunning")
    : finished
      ? t("workbench.chat.placeholderDone")
      : t("workbench.chat.placeholder");
  const showResume = !running && !awaited && unfinished(state);
  const suggestions = !running && !awaited && finished ? t("workbench.chat.suggestions").split("|") : [];

  return (
    <div className={styles.pane}>
      <div ref={scroller} className={styles.transcript} onScroll={onScroll}>
        <div className={styles.transcriptInner} aria-live="polite">
          {state.messages.length === 0 && state.draft.draft.origin !== "agent" ? (
            <AgentRow>
              <div className={cx(styles.agentText, styles.muted)}>{finished ? t("workbench.chat.emptyEdit") : t("workbench.chat.emptyManual")}</div>
            </AgentRow>
          ) : null}
          {state.messages.map((message, i) => (
            <MessageView
              key={message.seq}
              message={message}
              actions={actions}
              avatar={!isAgentTurn(state.messages[i - 1])}
            />
          ))}
          {running ? <Live state={state} stopping={stopping} onStop={onStop} /> : null}
        </div>
      </div>
      <div className={styles.bottom}>
        <div className={styles.bottomInner}>
          {showResume ? (
            <div className={styles.actions}>
              <Button
                label={t("workbench.chat.continue")}
                icon="play"
                variant="secondary"
                size="sm"
                busy={resuming}
                onClick={() => void onResume()}
              />
            </div>
          ) : null}
          {suggestions.length ? (
            <div className={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" className={styles.suggestion} onClick={() => setText(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.composer}>
            <textarea
              className={styles.composerInput}
              aria-label={t("workbench.chat.placeholder")}
              placeholder={placeholder}
              value={text}
              rows={1}
              maxLength={8000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
            <IconButton
              icon="send"
              label={t("workbench.chat.send")}
              tone="plain"
              diameter={36}
              iconSize={18}
              className={styles.send}
              disabled={!text.trim() || sending || running}
              onClick={() => void submit()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 上一条是 agent 说的：这一条接着画，不再画头像 */
function isAgentTurn(message: WorkbenchMessage | undefined): boolean {
  return message?.role === "assistant";
}
