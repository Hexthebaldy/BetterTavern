/**
 * 一份草稿（W02–W06，地址 /workbench/d/:id，同 App 的 app/workbench/[id].tsx）。
 * 顶上一条：返回工作台、名字和保存状态、“Agent / 手动”切换（随时可以切，改的是同一份草稿）、进度、保存。
 * 下面两栏：Agent 模式左边对话、右边卡片预览；手动模式左边表单、右边检查。窄于 1100 时只有左栏，右栏从页头的“预览卡片”打开。
 * 宽屏时导航收成导航条，给两栏腾地方。
 *
 * 保存进角色卡仓库：
 * - 先把手动表单没存的存掉，再按保存的规则检查，有 error 就提示第一处（手动模式滚到那一节）；
 * - 仓库里的卡在别处改过（409 CARD_CHANGED）：问覆盖还是另存成新卡；
 * - “保存并开始新故事”顺便用这张卡建一个剧本，然后去剧本页开始。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { SaveOptions } from "@bettertavern/core/api/endpoints";
import type { DraftMode, DraftSave, Issue } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { blocking, describeIssue } from "@bettertavern/core/scenario/cardEdit";
import { draftStatus, progressSteps } from "@bettertavern/core/workbench/progress";

import { Button, cx, Dots, IconButton, Notice } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { scenarioPath } from "../../data/scenarioActions.ts";
import { draftsKey } from "../../data/scenarios.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import overlayStyles from "../../overlay/overlay.module.css";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useShell } from "../../shell/AppShell.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { navMode } from "../../theme/layout.ts";
import { AgentPane } from "./AgentPane.tsx";
import { useCoverActions } from "./assets.tsx";
import { CoverDialog } from "./CoverDialog.tsx";
import { CheckPanel, ManualPane, scrollToIssue } from "./ManualPane.tsx";
import { PreviewPane } from "./PreviewPane.tsx";
import { useCardForm, type AutosaveStatus } from "./useCardForm.ts";
import { useDraftSession } from "./useDraftSession.ts";
import { draftTitle } from "./WorkbenchHome.tsx";
import styles from "./workbench.module.css";

type Conflict = "overwrite" | "copy" | null;

function ConflictDialog({ onSettle }: { onSettle: (choice: Conflict) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog label={t("workbench.header.conflictTitle")} onClose={() => onSettle(null)} bare>
      <div className={overlayStyles.dialogBody}>
        <span className={cx(overlayStyles.dialogIcon, overlayStyles.warn)}>
          <Icon name="alert" size={24} />
        </span>
        <h2 className={overlayStyles.dialogTitle}>{t("workbench.header.conflictTitle")}</h2>
        <div className={overlayStyles.dialogMessage}>{t("workbench.header.conflictMessage")}</div>
      </div>
      <div className={styles.choiceButtons}>
        <Button label={t("workbench.header.overwrite")} size="lg" onClick={() => onSettle("overwrite")} />
        <Button label={t("workbench.header.saveAsNew")} variant="secondary" size="lg" onClick={() => onSettle("copy")} />
        <Button label={t("common.cancel")} variant="text" onClick={() => onSettle(null)} />
      </div>
    </Dialog>
  );
}

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

export function DraftPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { api } = useApp();
  const navigate = useNavigate();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const session = useDraftSession(id);
  const form = useCardForm(id, session);
  const cover = useCoverActions(id, session);
  const { state } = session;
  const [coverOpen, setCoverOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState<"save" | "start" | null>(null);
  const [switching, setSwitching] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [conflict, setConflict] = useState<((choice: Conflict) => void) | null>(null);

  // 宽屏时导航收成导航条
  const { setNavOverride } = useShell();
  const width = useWindowWidth();
  const { sidebarCollapsed } = usePrefs();
  const preferred = navMode(width, sidebarCollapsed);
  useEffect(() => {
    setNavOverride(preferred === "sidebar" ? "rail" : null);
  }, [preferred, setNavOverride]);
  useEffect(() => () => setNavOverride(null), [setNavOverride]);

  // 离开时草稿列表（更新时间、状态）重新取
  useEffect(() => () => void queries.invalidateQueries({ queryKey: draftsKey }), [queries]);

  const manual = state?.draft.draft.mode === "manual";
  const title = state
    ? manual && form.form
      ? form.form.displayName.trim() || form.form.name.trim() || t("workbench.home.untitled")
      : draftTitle(state.draft.draft, t("workbench.home.untitled"))
    : t("workbench.title");
  useDocumentTitle(title, state?.agentStatus === "running");

  const refresh = useCallback(async () => {
    try {
      session.setDraft(await api.workbench.get(id));
    } catch {
      // 下次事件再读
    }
  }, [api, id, session]);

  if (!state) {
    return (
      <div className={styles.draft}>
        <header className={styles.bar}>
          <button type="button" className={styles.back} onClick={() => navigate("/workbench")}>
            <Icon name="back" size={18} />
            <span className={styles.backText}>{t("workbench.title")}</span>
          </button>
        </header>
        {session.error ? (
          <div className={styles.center}>
            <Notice
              message={
                session.error instanceof ApiError && session.error.code === "NOT_FOUND"
                  ? t("cardEdit.loadFailed")
                  : t("cardEdit.loadFailedWith", { error: describeError(session.error) })
              }
              actionLabel={t("common.reload")}
              onAction={() => void session.reload()}
            />
          </div>
        ) : (
          <div className={styles.loading}>
            <Dots />
          </div>
        )}
      </div>
    );
  }

  const draft = state.draft;
  const running = state.agentStatus === "running";
  const researched = draft.notes.length > 0 || state.messages.some((m) => m.kind === "research");
  const steps = progressSteps(draft.draft.origin, state.stage, researched);
  const subtitle = (manual ? autosaveText(form.status) : null) ?? draftStatus({ ...draft.draft, agent_status: state.agentStatus, awaiting: state.awaiting, stage: state.stage });

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
    if (manual) scrollToIssue(first);
  };

  const askConflict = (): Promise<Conflict> => new Promise((resolve) => setConflict(() => resolve));

  const save = async (startStory: boolean): Promise<void> => {
    if (saving) return;
    if (manual && !(await form.flush())) return;
    const issues = blocking(manual ? form.issues : draft.issues);
    if (issues.length) {
      reportIssues(issues);
      return;
    }
    setSaving(startStory ? "start" : "save");
    const hadCard = draft.draft.card_id !== null;
    const options: SaveOptions = startStory ? { new_scenario: true } : {};
    let result: DraftSave | null = null;
    try {
      try {
        result = await session.save(options);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "CARD_CHANGED")) throw e;
        const choice = await askConflict();
        setConflict(null);
        if (!choice) return;
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
      setSaving(null);
    }
    overlay.toast(hadCard ? t("workbench.header.savedUpdate") : t("workbench.header.savedNew"));
    if (startStory && result.scenario) navigate(scenarioPath(result.scenario));
  };

  const more = async (anchor: HTMLElement): Promise<void> => {
    const key = await overlay.menu({
      label: t("workbench.header.more"),
      place: { anchor },
      items: [{ key: "delete", label: t("workbench.header.delete"), icon: "trash", danger: true }],
    });
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
      navigate("/workbench", { replace: true });
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const side = manual ? (
    <CheckPanel form={form} />
  ) : (
    <PreviewPane state={state} cover={cover} onOpenCover={() => setCoverOpen(true)} />
  );
  const narrow = width < 1100;

  return (
    <div className={styles.draft}>
      <header className={styles.bar}>
        <button type="button" className={styles.back} onClick={() => navigate("/workbench")} aria-label={t("workbench.header.backToHome")}>
          <Icon name="back" size={18} />
          <span className={styles.backText}>{t("workbench.title")}</span>
        </button>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          <span className={cx(styles.subtitle, form.status.kind === "failed" && manual && styles.subtitleError)}>
            {subtitle}
          </span>
        </div>
        <div className={styles.modes} role="radiogroup" aria-label={t("workbench.modes.label")}>
          {(["agent", "manual"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={draft.draft.mode === mode}
              disabled={switching}
              className={cx(styles.mode, draft.draft.mode === mode && styles.modeOn)}
              onClick={() => void switchMode(mode)}
            >
              <Icon name={mode === "agent" ? "workbench" : "write"} size={14} />
              {t(`workbench.modes.${mode}`)}
            </button>
          ))}
        </div>
        <div className={styles.barSpacer} />
        <ol className={styles.steps} aria-label={t("workbench.modes.label")}>
          {steps.map((step, i) => (
            <li
              key={step.key}
              className={cx(styles.step, step.state === "done" && styles.stepDone, step.state === "doing" && styles.stepDoing)}
              aria-current={step.state === "doing" ? "step" : undefined}
            >
              {i > 0 ? <span className={styles.stepLine} aria-hidden="true" /> : null}
              <span className={styles.stepDot} aria-hidden="true" />
              {step.label}
            </li>
          ))}
        </ol>
        <div className={styles.barButtons}>
          <IconButton
            icon="eye"
            label={t("workbench.header.preview")}
            className={styles.previewButton}
            onClick={() => setPreviewOpen(true)}
          />
          <IconButton icon="more" label={t("workbench.header.more")} onClick={(e) => void more(e.currentTarget)} />
          <Button
            label={t("workbench.header.saveAndStart")}
            variant="secondary"
            size="sm"
            className={narrow ? styles.hidden : undefined}
            busy={saving === "start"}
            disabled={running || saving !== null}
            onClick={() => void save(true)}
          />
          <Button
            label={narrow ? t("workbench.header.saveShort") : t("workbench.header.save")}
            size="sm"
            busy={saving === "save"}
            disabled={running || saving !== null}
            onClick={() => void save(false)}
          />
        </div>
      </header>
      <div className={cx(styles.body, manual && styles.bodyManual)}>
        <div className={styles.left}>
          {manual ? (
            <ManualPane form={form} draft={draft} showEmpty={showEmpty} onOpenCover={() => setCoverOpen(true)} />
          ) : (
            <AgentPane session={session} state={state} pickCover={cover.pick} />
          )}
        </div>
        {narrow ? null : <aside className={styles.right}>{side}</aside>}
      </div>
      {previewOpen && narrow ? (
        <Dialog label={t("workbench.header.preview")} onClose={() => setPreviewOpen(false)} width={560} bare className={styles.previewDialog}>
          {side}
        </Dialog>
      ) : null}
      {coverOpen ? (
        <CoverDialog draft={draft} cover={cover} onGenerated={refresh} onClose={() => setCoverOpen(false)} />
      ) : null}
      {conflict ? <ConflictDialog onSettle={(choice) => conflict(choice)} /> : null}
    </div>
  );
}
