/**
 * Agent 模式（同网页端 pages/workbench/AgentPane.tsx）：对话记录，正在发生的事（agent 正在说的话、正在用的工具、
 * 进度清单和“停止”），底下是建议和输入框。
 * - agent 在跑时不能发（DRAFT_BUSY），在等回答时可以直接说话；
 * - 上一轮被停下、出错、没写完，或者手动开始的草稿还没让 agent 动过手：显示“接着写完”；
 * - 新内容出来时，看的是最底下就跟着滚到底，往上翻着看时不打扰。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Asset, NewMessage, WorkbenchMessage } from "@bettertavern/core/api/types";
import { toolLabel, writingLabel } from "@bettertavern/core/workbench/labels";
import { canTalk } from "@bettertavern/core/workbench/progress";
import { awaitedMessage, type WorkbenchState } from "@bettertavern/core/workbench/session";

import { Button, Dots, Icon, IconButton, useOverlay } from "../../components/ui.tsx";
import { radius, space, usePalette } from "../../theme/index.ts";
import { chat } from "./chatStyles.ts";
import { AgentRow, MessageView, type MessageActions } from "./Messages.tsx";
import type { DraftSession } from "./useDraftSession.ts";

function unfinished(state: WorkbenchState): boolean {
  const last = state.messages.at(-1);
  // 还没让 agent 动过手的草稿：没写完才“接着写完”（从仓库打开的、写好的卡只能提要求）
  if (!last) return state.draft.draft.origin !== "agent" && state.stage !== "done" && state.stage !== "revise";
  if (last.kind === "error") return true;
  if (last.kind === "progress") return last.content.stopped || !last.content.complete;
  return false;
}

function Live({ state, stopping, onStop }: { state: WorkbenchState; stopping: boolean; onStop: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const writingTool = !state.tool || state.tool.name === "write_field" || state.tool.name === "lore_upsert";
  const working =
    state.writing && writingTool ? writingLabel(state.writing.target) : state.tool ? toolLabel(state.tool) : null;
  const done = state.todos.filter((todo) => todo.state === "done").length;
  const stopButton = (
    <Button
      label={stopping ? t("workbench.chat.stopping") : t("workbench.chat.stop")}
      icon="stop"
      variant="secondary"
      onGrey
      disabled={stopping}
      onPress={onStop}
      style={{ minHeight: 36, height: 36, alignSelf: "flex-start" }}
    />
  );
  return (
    <AgentRow>
      {state.speaking ? <Text style={[chat.agentText, { color: palette.ink }]}>{state.speaking}</Text> : null}
      {working || !state.speaking ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Dots color={palette.mut} cell={5} />
          <Text style={{ fontSize: 13, color: palette.mut }}>{working ?? t("workbench.chat.thinking")}</Text>
        </View>
      ) : null}
      {state.todos.length ? (
        <View style={[chat.card, { backgroundColor: palette.bg2 }]}>
          <View style={chat.cardHead}>
            <Text style={[chat.cardTitle, { color: palette.ink }]}>
              {t("workbench.status.running")}{" "}
              <Text style={{ color: palette.mut, fontWeight: "400" }}>
                {done} / {state.todos.length}
              </Text>
            </Text>
            {stopButton}
          </View>
          {state.todos.map((todo) => {
            const doneItem = todo.state === "done";
            const doing = todo.state === "doing";
            return (
              <View
                key={todo.key}
                style={[
                  styles.todo,
                  doing ? { backgroundColor: palette.card } : null,
                ]}
              >
                <View
                  style={[
                    styles.mark,
                    {
                      borderColor: doneItem ? palette.ink : doing ? palette.acc : palette.line2,
                      backgroundColor: doneItem ? palette.ink : doing ? palette.acc : "transparent",
                    },
                  ]}
                >
                  {doneItem ? <Icon name="check" size={11} color={palette.bg} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: doneItem || doing ? palette.ink : palette.mut }}>{todo.text}</Text>
                  {todo.detail ? <Text style={{ fontSize: 12, color: palette.mut }}>{todo.detail}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        stopButton
      )}
    </AgentRow>
  );
}

export function AgentPane({
  session,
  state,
  pickCover,
  bottomInset,
}: {
  session: DraftSession;
  state: WorkbenchState;
  pickCover: (asset: Asset) => Promise<boolean>;
  bottomInset: number;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const overlay = useOverlay();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [resuming, setResuming] = useState(false);
  const scroller = useRef<ScrollView>(null);
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

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    pinned.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
  };

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
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={styles.transcript}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={() => {
          if (pinned.current) scroller.current?.scrollToEnd({ animated: false });
        }}
      >
        {state.messages.length === 0 && state.draft.draft.origin !== "agent" ? (
          <AgentRow>
            <Text style={[chat.agentText, { color: palette.mut }]}>{finished ? t("workbench.chat.emptyEdit") : t("workbench.chat.emptyManual")}</Text>
          </AgentRow>
        ) : null}
        {state.messages.map((message, i) => (
          <MessageView
            key={message.seq}
            message={message}
            actions={actions}
            avatar={state.messages[i - 1]?.role !== "assistant"}
          />
        ))}
        {running ? <Live state={state} stopping={stopping} onStop={onStop} /> : null}
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: bottomInset + space.s }]}>
        {showResume ? (
          <Button
            label={t("workbench.chat.continue")}
            icon="play"
            variant="secondary"
            busy={resuming}
            onPress={() => void onResume()}
            style={{ minHeight: 40, height: 40, alignSelf: "flex-start" }}
          />
        ) : null}
        {suggestions.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {suggestions.map((suggestion) => (
              <Text
                key={suggestion}
                accessibilityRole="button"
                onPress={() => setText(suggestion)}
                style={[styles.suggestion, { borderColor: palette.line, color: palette.ink2 }]}
              >
                {suggestion}
              </Text>
            ))}
          </ScrollView>
        ) : null}
        <View style={[styles.composer, { backgroundColor: palette.bg2 }]}>
          <TextInput
            accessibilityLabel={t("workbench.chat.placeholder")}
            placeholder={placeholder}
            placeholderTextColor={palette.mut}
            value={text}
            multiline
            maxLength={8000}
            onChangeText={setText}
            style={[styles.input, { color: palette.ink }]}
          />
          <IconButton
            icon="send"
            label={t("workbench.chat.send")}
            diameter={36}
            size={18}
            tone="plain"
            color={palette.bg}
            disabled={!text.trim() || sending || running}
            onPress={() => void submit()}
            style={{ backgroundColor: palette.ink }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  transcript: { paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l, gap: space.l },
  todo: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 6, borderRadius: 12 },
  mark: {
    width: 18,
    height: 18,
    marginTop: 1,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: { paddingHorizontal: space.m, paddingTop: space.s, gap: space.s },
  suggestion: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    fontSize: 13,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.s,
    paddingLeft: space.l,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 24,
  },
  input: { flex: 1, maxHeight: 140, paddingVertical: 8, fontSize: 15, lineHeight: 22 },
});
