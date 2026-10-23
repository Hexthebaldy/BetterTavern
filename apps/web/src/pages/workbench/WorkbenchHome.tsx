/**
 * 工作台首页（docs/design/comic 的 06）：漫画格子，不翻页。
 * - 左上大格：“想做一个什么样的角色？”和一个气泡形状的输入框，下面三条示例（点一下填进输入框）；
 *   Enter 发送、Shift+Enter 换行，发出去就新建一份草稿并开 agent 的第一轮，进草稿页；
 * - 右边一格墨底的“导入角色卡”（点虚线框选文件，也可以把文件拖进窗口，ImportProvider 接），一格“手动新建”；
 * - 最下面一行是没保存的草稿（写明 agent 在干什么：正在写时是五步进度，在等你时写等什么）和最近保存的角色卡。
 * 页头右边“草稿 N”列出全部草稿。设计稿里草稿格的气泡（agent 问的那个问题）要读草稿详情才有，先不画。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { DraftSummary } from "@bettertavern/core/api/types";
import { formatRelative } from "@bettertavern/core/utils/format";
import { draftStatus, progressSteps } from "@bettertavern/core/workbench/progress";

import { Caption, Panel, panelClass, Portrait } from "../../components/comic.tsx";
import { ComicGrid } from "../../components/ComicGrid.tsx";
import { buttonClass, cx, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { HeaderTool, PageHeader } from "../../components/PageHeader.tsx";
import { cardsKey, draftsKey, useCards, useDrafts } from "../../data/scenarios.ts";
import { cardPath, draftPath } from "../../data/workbench.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useImporter } from "../../import/ImportProvider.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { byRecent } from "../../shell/recent.ts";
import { useApp } from "../../state/AppProvider.tsx";
import pages from "../pages.module.css";
import styles from "./home.module.css";

export function draftTitle(draft: Pick<DraftSummary, "name" | "character_name">, untitled: string): string {
  return draft.name || draft.character_name || untitled;
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
    if (creating) return;
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

  const draftList = byRecent(drafts.data ?? []);
  const recent = byRecent(cards.data ?? []).slice(0, 3);
  const shownDrafts = draftList.slice(0, 2);

  const listDrafts = async (anchor: HTMLElement): Promise<void> => {
    const key = await overlay.menu({
      label: t("workbench.home.drafts"),
      place: { anchor },
      items: draftList.map((d) => ({
        key: d.id,
        label: `${draftTitle(d, t("workbench.home.untitled"))} · ${draftStatus(d)}`,
        icon: "write" as const,
      })),
    });
    if (key) navigate(draftPath(key));
  };

  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.workbench")} sub={t("workbench.home.sub")}>
        {draftList.length > 0 ? (
          <HeaderTool
            icon="list"
            label={t("nav.drafts", { count: draftList.length })}
            aria-haspopup="menu"
            onClick={(event) => void listDrafts(event.currentTarget)}
          />
        ) : null}
      </PageHeader>
      {importer.problem ? (
        <Notice
          message={
            <>
              <strong>{importer.problem.title}</strong> {importer.problem.message}
            </>
          }
          onClose={importer.dismissProblem}
          className={styles.notice}
        />
      ) : null}
      {problem ? <Notice message={problem} onClose={() => setProblem(null)} className={styles.notice} /> : null}
      {drafts.error ? (
        <Notice
          icon="offline"
          message={t("workbench.home.loadFailed")}
          actionLabel={t("common.retry")}
          onAction={() => void drafts.refetch()}
          className={styles.notice}
        />
      ) : null}

      <ComicGrid paged={false}>
        {/* 一句话开始 */}
        <Panel tone="dots" hot className={styles.agent} style={{ gridColumn: "1 / span 4", gridRow: "1 / span 2" }}>
          <div className={styles.agentHead}>
            <Pill tone="ink" label="AGENT" />
            <span className={styles.label}>{t("workbench.home.agentNote")}</span>
          </div>
          <h2 className={styles.prompt}>{t("workbench.home.prompt")}</h2>
          <div className={styles.composer}>
            <textarea
              className={styles.composerInput}
              aria-label={t("workbench.home.prompt")}
              placeholder={t("workbench.home.placeholder")}
              value={text}
              maxLength={8000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={1}
            />
            <button
              type="button"
              className={cx(buttonClass("primary", "sm"), styles.send)}
              disabled={!text.trim() || starting}
              onClick={() => void start()}
            >
              <Icon name="send" size={16} strokeWidth={2.2} />
              {t("workbench.home.send")}
            </button>
            <svg className={styles.tail} viewBox="0 0 26 20" aria-hidden="true">
              <path d="M1 0 L9 18 L23 0" />
              <rect x="2.4" y="-1.5" width="19.5" height="3.2" />
            </svg>
          </div>
          <div className={styles.examples} aria-label={t("workbench.home.examplesLabel")}>
            <span className={styles.label}>{t("workbench.home.examplesLabel")}</span>
            {examples.map((example) => (
              <button key={example} type="button" className={styles.example} onClick={() => setText(example)}>
                <Icon name="workbench" size={16} strokeWidth={2.2} />
                {example}
              </button>
            ))}
          </div>
        </Panel>

        {/* 导入角色卡 */}
        <Panel tone="ink" className={styles.importCell} style={{ gridColumn: "5 / span 2", gridRow: "1" }}>
          <div className={styles.cellHead}>
            <h2 className={styles.cellTitle}>
              {importer.progress
                ? t("workbench.import.importing", { name: importer.progress.name })
                : t("workbench.home.import")}
            </h2>
            <Icon name="import" size={24} strokeWidth={2.2} />
          </div>
          <span className={styles.importNote}>{t("workbench.import.dropFormats")}</span>
          <button
            type="button"
            className={styles.drop}
            onClick={importer.pick}
            disabled={importer.progress !== null}
          >
            {t("workbench.home.dropHere")}
          </button>
        </Panel>

        {/* 手动新建 */}
        <button
          type="button"
          className={cx(panelClass("white"), styles.manualCell)}
          style={{ gridColumn: "5 / span 2", gridRow: "2" }}
          onClick={() => void manual()}
          disabled={creating}
        >
          <span className={styles.cellHead}>
            <span className={styles.cellTitle}>{t("workbench.home.manual")}</span>
            <Icon name="write" size={24} strokeWidth={2.2} />
          </span>
          <span className={styles.manualNote}>{t("workbench.home.manualLong")}</span>
          <Caption className={styles.manualHint}>{t("workbench.home.manualHint")}</Caption>
        </button>

        {/* 草稿 */}
        {shownDrafts.length === 0 ? (
          <Panel tone="grey" className={styles.noDrafts} style={{ gridColumn: "1 / span 4", gridRow: "3" }}>
            <span className={styles.label}>{t("workbench.home.drafts")}</span>
            <span className={styles.noDraftsText}>{t("workbench.home.noDrafts")}</span>
          </Panel>
        ) : (
          shownDrafts.map((draft, i) => (
            <DraftCell
              key={draft.id}
              draft={draft}
              column={shownDrafts.length === 1 ? "1 / span 4" : `${1 + i * 2} / span 2`}
              onRemove={() => void remove(draft)}
            />
          ))
        )}

        {/* 最近保存的角色卡 */}
        <Panel className={styles.recent} style={{ gridColumn: "5 / span 2", gridRow: "3" }}>
          <span className={styles.label}>{t("workbench.home.recent")}</span>
          {recent.length === 0 ? <span className={styles.noDraftsText}>{t("library.emptyCards")}</span> : null}
          <div className={styles.recentList}>
            {recent.map((card) => (
              <Link key={card.id} to={cardPath(card.id)} className={styles.recentRow}>
                <Portrait
                  name={card.character_name || card.name}
                  seed={card.id}
                  blobId={card.cover_blob_id}
                  size={34}
                  radius={8}
                />
                <b className={styles.recentName}>{card.name}</b>
                <span className={styles.recentTime}>{formatRelative(card.updated_at)}</span>
              </Link>
            ))}
          </div>
          <Link to="/characters" className={styles.more}>
            {t("workbench.home.allCards")} →
          </Link>
        </Panel>
      </ComicGrid>
    </div>
  );
}

/** 一份草稿：在干什么（正在写时是五步进度），草稿名，右下角是时间或“去回答 →” */
function DraftCell({ draft, column, onRemove }: { draft: DraftSummary; column: string; onRemove: () => void }) {
  const { t } = useTranslation();
  const running = draft.agent_status === "running";
  const waiting = draft.agent_status === "awaiting_user";
  const steps = draft.mode === "agent" ? progressSteps(draft.origin, draft.stage, draft.stage === "research") : [];
  return (
    <div className={styles.draftCell} style={{ gridColumn: column, gridRow: "3" }}>
      <Link to={draftPath(draft.id)} className={cx(panelClass("white"), styles.draft)}>
        <span className={styles.agentHead}>
          {running ? (
            <Pill tone="acc" dot label={draftStatus(draft)} />
          ) : waiting ? (
            <Pill tone="ink" label={draftStatus(draft)} />
          ) : (
            <Pill tone="card" label={draftStatus(draft)} />
          )}
          <span className={styles.label}>{t("workbench.home.draftChip")}</span>
        </span>
        <span className={styles.draftName}>{draftTitle(draft, t("workbench.home.untitled"))}</span>
        {running && steps.length > 0 ? (
          <span className={styles.steps}>
            {steps.map((step, i) => (
              <span key={step.key} className={styles.stepWrap}>
                {i > 0 ? <i className={styles.stepLine} /> : null}
                <span className={cx(styles.step, step.state === "done" && styles.stepDone, step.state === "doing" && styles.stepOn)}>
                  {step.label}
                </span>
              </span>
            ))}
          </span>
        ) : null}
        <span className={cx(styles.draftTime, waiting && styles.answer)}>
          {waiting ? `${t("workbench.home.answer")} →` : formatRelative(draft.updated_at)}
        </span>
      </Link>
      <IconButton
        icon="trash"
        label={t("workbench.home.deleteDraft")}
        tone="card"
        diameter={32}
        iconSize={16}
        className={styles.draftDelete}
        onClick={onRemove}
      />
    </div>
  );
}
