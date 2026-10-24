/**
 * 一份草稿（同网页端 pages/workbench/DraftPage.tsx）。
 * 顶上：返回、名字和保存状态、预览、更多；第二行是“Agent / 手动”切换（随时可以切，改的是同一份草稿）和“保存”。
 * Agent 模式是对话（AgentPane），手动模式是表单（ManualPane）；卡片预览、检查从“预览”打开整屏面板。
 *
 * 保存进角色卡仓库：
 * - 先把手动表单没存的存掉，再按保存的规则检查，有 error 就提示第一处（手动模式滚到那一节）；
 * - 仓库里的卡在别处改过（409 CARD_CHANGED）：问覆盖还是另存成新卡；
 * - “保存并开始新故事”（在“更多”里）顺便用这张卡建一个剧本，然后去剧本页开始。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { SaveOptions } from "@bettertavern/core/api/endpoints";
import type { DraftMode, DraftSave, Issue } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { blocking, describeIssue } from "@bettertavern/core/scenario/cardEdit";
import { draftStatus, progressSteps } from "@bettertavern/core/workbench/progress";

import { Button, ErrorState, IconButton, Loading, Segmented, useOverlay } from "../../src/components/ui.tsx";
import { useCoverActions } from "../../src/features/workbench/assets.tsx";
import { AgentPane } from "../../src/features/workbench/AgentPane.tsx";
import { CoverSheet } from "../../src/features/workbench/CoverSheet.tsx";
import { ManualPane, type ManualPaneHandle } from "../../src/features/workbench/ManualPane.tsx";
import { CheckBody, PreviewSheet } from "../../src/features/workbench/PreviewSheet.tsx";
import { useCardForm, type AutosaveStatus } from "../../src/features/workbench/useCardForm.ts";
import { useDraftSession } from "../../src/features/workbench/useDraftSession.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { comicStroke, space, useComic } from "../../src/theme/index.ts";

function autosaveText(status: AutosaveStatus): string | null {
  switch (status.kind) {
    case "pending":
    case "saving":
      return i18n.t("workbench.header.autosaving");
    case "saved":
      return i18n.t("workbench.header.autosaved");
    case "failed":
      return i18n.t("workbench.header.autosaveFailed", { error: status.error });
    default:
      return null;
  }
}

export default function DraftScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const overlay = useOverlay();
  const c = useComic();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const session = useDraftSession(id);
  const form = useCardForm(id, session);
  const cover = useCoverActions(id, session);
  const manualRef = useRef<ManualPaneHandle>(null);
  const [preview, setPreview] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const { state } = session;

  const refresh = useCallback(async () => {
    try {
      session.setDraft(await api.workbench.get(id));
    } catch {
      // 下次事件再读
    }
  }, [api, id, session]);

  if (!state) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
        {session.error ? (
          <ErrorState
            title={t("cardEdit.loadFailed")}
            message={describeError(session.error)}
            onRetry={() => void session.reload()}
            style={{ marginTop: insets.top + space.xxl }}
          />
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  const draft = state.draft;
  const manual = draft.draft.mode === "manual";
  const running = state.agentStatus === "running";
  const title = manual && form.form
    ? form.form.displayName.trim() || form.form.name.trim() || t("workbench.home.untitled")
    : draft.draft.name || draft.draft.character_name || t("workbench.home.untitled");
  const subtitle =
    (manual ? autosaveText(form.status) : null) ??
    draftStatus({ ...draft.draft, agent_status: state.agentStatus, awaiting: state.awaiting, stage: state.stage });
  const researched = draft.notes.length > 0 || state.messages.some((m) => m.kind === "research");
  const steps = progressSteps(draft.draft.origin, state.stage, researched);

  const switchMode = async (mode: DraftMode): Promise<void> => {
    if (mode === draft.draft.mode || switching) return;
    setSwitching(true);
    try {
      if (manual) await form.flush();
      await session.setMode(mode);
      if (mode === "manual" && running) overlay.toast(t("workbench.chat.handoffNote"), { icon: "info" });
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    } finally {
      setSwitching(false);
    }
  };

  const reportIssues = (issues: readonly Issue[]): void => {
    const first = issues[0];
    if (!first) return;
    setShowEmpty(true);
    overlay.toast(t("workbench.header.notReady", { problem: describeIssue(first) }), { icon: "alert" });
    if (manual) manualRef.current?.scrollToIssue(first);
  };

  const save = async (startStory: boolean): Promise<void> => {
    if (saving) return;
    if (manual && !(await form.flush())) return;
    const issues = blocking(manual ? form.issues : draft.issues);
    if (issues.length) {
      reportIssues(issues);
      return;
    }
    setSaving(true);
    const hadCard = draft.draft.card_id !== null;
    const options: SaveOptions = startStory ? { new_scenario: true } : {};
    let result: DraftSave;
    try {
      try {
        result = await session.save(options);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "CARD_CHANGED")) throw e;
        const choice = await overlay.menu({
          title: t("workbench.header.conflictTitle"),
          items: [
            { key: "overwrite", label: t("workbench.header.overwrite"), icon: "write" },
            { key: "copy", label: t("workbench.header.saveAsNew"), icon: "plus" },
          ],
        });
        if (choice !== "overwrite" && choice !== "copy") return;
        result = await session.save({ ...options, on_conflict: choice });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "CARD_CHECK_FAILED") {
        const found = e.field("issues");
        reportIssues(Array.isArray(found) ? (found as Issue[]) : []);
      } else {
        overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
      }
      return;
    } finally {
      setSaving(false);
    }
    overlay.toast(hadCard ? t("workbench.header.savedUpdate") : t("workbench.header.savedNew"));
    if (startStory && result.scenario) {
      router.push({ pathname: "/scenario/[id]", params: { id: result.scenario.id } });
    }
  };

  const more = async (): Promise<void> => {
    const key = await overlay.menu({
      title,
      items: [
        { key: "start", label: t("workbench.header.saveAndStart"), icon: "play" },
        { key: "delete", label: t("workbench.header.delete"), icon: "trash", danger: true },
      ],
    });
    if (key === "start") void save(true);
    if (key !== "delete") return;
    const ok = await overlay.confirm({
      title: t("workbench.home.deleteDraftConfirm"),
      message: t("workbench.home.deleteDraftMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.workbench.remove(id);
      router.back();
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <View style={[styles.header, { paddingTop: insets.top + space.xs, borderBottomColor: c.ink }]}>
        <View style={styles.row}>
          <IconButton icon="back" label={t("workbench.header.backToHome")} diameter={38} onPress={() => router.back()} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.title, { color: c.ink }]}>
              {title}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: 12, color: form.status.kind === "failed" && manual ? c.err : c.mut }}
            >
              {subtitle}
            </Text>
          </View>
          <IconButton icon="eye" label={t("workbench.header.preview")} diameter={38} onPress={() => setPreview(true)} />
          <IconButton icon="more" label={t("workbench.header.more")} diameter={38} onPress={() => void more()} />
        </View>
        <View style={styles.row}>
          <Segmented
            hideLabel
            label={t("workbench.modes.label")}
            value={draft.draft.mode}
            height={40}
            options={[
              { value: "agent", label: t("workbench.modes.agent"), icon: "workbench" },
              { value: "manual", label: t("workbench.modes.manual"), icon: "write" },
            ]}
            onChange={(mode) => void switchMode(mode)}
            style={{ flex: 1 }}
          />
          <Button
            label={t("workbench.header.saveShort")}
            busy={saving}
            disabled={running}
            onPress={() => void save(false)}
            small
          />
        </View>
        {manual ? null : (
          // 需求 — 方案 — 动手 — 检查：做完的墨色，正在做的蓝色，还没到的灰色
          <Text numberOfLines={1} style={styles.steps}>
            {steps.map((step, i) => {
              const color = step.state === "doing" ? c.acc : step.state === "done" ? c.ink : c.mut;
              return (
                <Text key={step.label}>
                  {i > 0 ? <Text style={{ color: c.grey2 }}>{"  —  "}</Text> : null}
                  <Text style={{ color: step.state === "todo" ? c.disabledLine : color }}>● </Text>
                  <Text style={{ color, fontWeight: step.state === "doing" ? "700" : "400" }}>{step.label}</Text>
                </Text>
              );
            })}
          </Text>
        )}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {manual ? (
          <ManualPane
            ref={manualRef}
            form={form}
            draft={draft}
            showEmpty={showEmpty}
            onOpenCover={() => setCoverOpen(true)}
            bottomInset={insets.bottom}
          />
        ) : (
          <AgentPane session={session} state={state} pickCover={cover.pick} bottomInset={insets.bottom} />
        )}
      </KeyboardAvoidingView>
      <PreviewSheet
        visible={preview}
        onClose={() => setPreview(false)}
        state={state}
        cover={cover}
        onOpenCover={() => {
          setPreview(false);
          setCoverOpen(true);
        }}
        manual={
          manual && form.form ? (
            <CheckBody
              card={form.form}
              issues={form.issues}
              onPick={(issue) => {
                setPreview(false);
                manualRef.current?.scrollToIssue(issue);
              }}
            />
          ) : undefined
        }
      />
      <CoverSheet
        visible={coverOpen}
        draft={draft}
        cover={cover}
        onGenerated={refresh}
        onClose={() => setCoverOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.m,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: comicStroke.frame,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.s },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "900" },
  steps: { fontSize: 13, lineHeight: 18, paddingHorizontal: space.xs },
});
