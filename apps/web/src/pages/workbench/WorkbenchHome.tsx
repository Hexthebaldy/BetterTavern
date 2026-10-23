/**
 * 工作台首页（W01，同 App 的 app/(tabs)/workbench.tsx）：一句话开始（输入框和示例），导入角色卡（按钮，也可以把文件拖进窗口），
 * 手动新建；下面是没保存的草稿（写明在等什么）和最近保存的角色卡。
 * 输入框里 Enter 发送、Shift+Enter 换行；发出去就新建一份草稿并开 agent 的第一轮，进草稿页。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { DraftSummary } from "@bettertavern/core/api/types";
import { formatRelative } from "@bettertavern/core/utils/format";
import { cardOrigin } from "@bettertavern/core/workbench/labels";
import { draftStatus } from "@bettertavern/core/workbench/progress";

import { Cover } from "../../components/Cover.tsx";
import { cx, IconButton, Notice } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { cardsKey, draftsKey, useCards, useDrafts } from "../../data/scenarios.ts";
import { cardPath, draftPath } from "../../data/workbench.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useImporter } from "../../import/ImportProvider.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import pages from "../pages.module.css";
import styles from "./workbench.module.css";

export function draftTitle(draft: Pick<DraftSummary, "name" | "character_name">, untitled: string): string {
  return draft.name || draft.character_name || untitled;
}

function Entry({
  icon,
  title,
  note,
  busy,
  onClick,
}: {
  icon: IconName;
  title: string;
  note: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={cx(styles.entry, "pressable")} onClick={onClick} disabled={busy}>
      <span className={styles.entryIcon}>
        <Icon name={icon} size={20} />
      </span>
      <span className={styles.entryTitle}>{title}</span>
      <span className={styles.entryNote}>{note}</span>
    </button>
  );
}

export function WorkbenchHome() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t("nav.workbench"));
  const { api } = useApp();
  const navigate = useNavigate();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const importer = useImporter();
  const drafts = useDrafts();
  const cards = useCards();
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const examples = t("workbench.home.examples").split("|");

  const start = async (): Promise<void> => {
    const value = text.trim();
    if (!value || starting) return;
    setStarting(true);
    setProblem(null);
    try {
      const draft = await api.workbench.startAgent(value, i18n.language);
      void queries.invalidateQueries({ queryKey: draftsKey });
      navigate(draftPath(draft.draft.id));
    } catch (e) {
      setProblem(describeError(e));
      setStarting(false);
    }
  };

  const manual = async (): Promise<void> => {
    setCreating(true);
    try {
      const draft = await api.workbench.createManual(i18n.language);
      void queries.invalidateQueries({ queryKey: draftsKey });
      navigate(draftPath(draft.draft.id));
    } catch (e) {
      setProblem(describeError(e));
      setCreating(false);
    }
  };

  const remove = async (draft: DraftSummary): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("workbench.home.deleteDraftConfirm"),
      message: t("workbench.home.deleteDraftMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.workbench.remove(draft.id);
      queries.setQueryData<DraftSummary[]>(draftsKey, (list) => list?.filter((d) => d.id !== draft.id));
      void queries.invalidateQueries({ queryKey: cardsKey });
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void start();
    }
  };

  const draftList = drafts.data ?? [];
  const recent = (cards.data ?? []).slice(0, 3);
  return (
    <div className={cx(pages.page, styles.home)}>
      <h1 className={styles.homeTitle}>{t("workbench.home.prompt")}</h1>
      {importer.problem ? (
        <Notice
          message={
            <>
              <strong>{importer.problem.title}</strong> {importer.problem.message}
            </>
          }
          onClose={importer.dismissProblem}
        />
      ) : null}
      {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}
      <div className={styles.composer}>
        <textarea
          className={styles.composerInput}
          aria-label={t("workbench.home.prompt")}
          placeholder={t("workbench.home.placeholder")}
          value={text}
          maxLength={8000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={3}
        />
        <div className={styles.composerBar}>
          <span className={styles.kbd}>Enter</span>
          <IconButton
            icon="send"
            label={t("workbench.home.send")}
            tone="plain"
            className={styles.sendButton}
            disabled={!text.trim() || starting}
            onClick={() => void start()}
          />
        </div>
      </div>
      <div className={styles.examples} aria-label={t("workbench.home.examplesLabel")}>
        {examples.map((example) => (
          <button key={example} type="button" className={styles.example} onClick={() => setText(example)}>
            {example}
          </button>
        ))}
      </div>
      <div className={styles.entries}>
        <Entry
          icon="import"
          title={importer.progress ? t("workbench.import.importing", { name: importer.progress.name }) : t("workbench.home.import")}
          note={t("workbench.home.importNote")}
          busy={importer.progress !== null}
          onClick={importer.pick}
        />
        <Entry
          icon="write"
          title={t("workbench.home.manual")}
          note={t("workbench.home.manualNote")}
          busy={creating}
          onClick={() => void manual()}
        />
      </div>

      {draftList.length > 0 ? (
        <section className={styles.homeSection}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t("workbench.home.drafts")}</h2>
          </div>
          <div className={styles.draftList}>
            {draftList.map((draft) => (
              <div key={draft.id} className={styles.draftRow}>
                <Link to={draftPath(draft.id)} className={styles.draftLink}>
                  <Cover seed={draft.id} blobId={draft.cover_blob_id} width={44} height={44} surface="onFill" />
                  <span className={styles.draftBody}>
                    <span className={styles.draftName}>{draftTitle(draft, t("workbench.home.untitled"))}</span>
                    <span className={cx(styles.draftStatus, draft.agent_status !== "idle" && styles.draftWaiting)}>
                      {draftStatus(draft)} · {formatRelative(draft.updated_at)}
                    </span>
                  </span>
                </Link>
                <IconButton
                  icon="trash"
                  label={t("workbench.home.deleteDraft")}
                  tone="plain"
                  diameter={36}
                  iconSize={18}
                  onClick={() => void remove(draft)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className={styles.homeSection}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t("workbench.home.recent")}</h2>
            <Link to="/characters" className={styles.sectionLink}>
              {t("workbench.home.allCards")}
            </Link>
          </div>
          <div className={styles.recent}>
            {recent.map((card) => (
              <Link key={card.id} to={cardPath(card.id)} className={styles.recentCard}>
                <Cover seed={card.id} blobId={card.cover_blob_id} width={48} height={48} surface="onFill" />
                <span className={styles.draftBody}>
                  <span className={styles.draftName}>{card.name}</span>
                  <span className={styles.draftStatus}>
                    {cardOrigin(card)} · {formatRelative(card.updated_at)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {drafts.error ? (
        <Notice
          icon="offline"
          message={t("workbench.home.loadFailed")}
          actionLabel={t("common.retry")}
          onAction={() => void drafts.refetch()}
        />
      ) : null}
    </div>
  );
}
