/**
 * Agent 模式的右栏（W02–W05，同 App 的 src/features/workbench/PreviewPane.tsx）：三个标签——
 * - 卡片：封面（点一下换）、名字、标签、各个字段；agent 正在写的字段蓝底实时出字，待采用的改动绿框显示改后的样子；
 *   最底下是按保存规则检查出的问题；
 * - 资料：agent 查资料时记下的笔记，每条用在了卡片的哪里；
 * - 图片：草稿里的图，点一下当封面。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Hunk, Issue } from "@bettertavern/core/api/types";
import { describeIssue, fieldLabel, TEXT_FIELDS, type TextField } from "@bettertavern/core/scenario/cardEdit";
import { awaitedMessage, type WorkbenchState } from "@bettertavern/core/workbench/session";
import { fieldList } from "@bettertavern/core/workbench/labels";

import { cx, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { AssetTile, BlobImage, type CoverActions } from "./assets.tsx";
import chat from "./chat.module.css";
import styles from "./preview.module.css";

type Tab = "card" | "notes" | "images";

/** 每个字段在等用户采用的改后内容 */
function pendingFields(state: WorkbenchState): { fields: Map<string, string>; others: number; total: number } {
  const awaited = awaitedMessage(state);
  const fields = new Map<string, string>();
  let others = 0;
  let total = 0;
  if (awaited?.kind === "changes") {
    for (const hunk of awaited.content.hunks as Hunk[]) {
      if (hunk.state !== "pending") continue;
      total += 1;
      if ("field" in hunk.target && hunk.after !== null) fields.set(hunk.target.field, hunk.after);
      else others += 1;
    }
  }
  return { fields, others, total };
}

export function IssueList({ issues, onPick }: { issues: readonly Issue[]; onPick?: (issue: Issue) => void }) {
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return (
    <div className={styles.issues}>
      {sorted.map((issue, i) => (
        <div
          key={`${issue.field}:${issue.code}:${i}`}
          className={cx(styles.issue, issue.level === "error" ? styles.issueError : styles.issueWarn)}
        >
          <Icon name={issue.level === "error" ? "alertCircle" : "info"} size={14} />
          {onPick ? (
            <button type="button" className={styles.issueButton} onClick={() => onPick(issue)}>
              {describeIssue(issue)}
            </button>
          ) : (
            <span>{describeIssue(issue)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function CardTab({ state, onOpenCover }: { state: WorkbenchState; onOpenCover: () => void }) {
  const { t } = useTranslation();
  const { card, draft } = state.draft;
  const pending = pendingFields(state);
  const writing = state.writing;
  const writingLore = writing?.target.startsWith("lore:") ? writing.target.slice(5) : null;

  const block = (field: TextField) => {
    const live = writing?.target === `field:${field}` ? writing.text : null;
    const changed = pending.fields.get(field);
    const text = live ?? changed ?? card[field];
    if (!text.trim() && live === null && (field === "system_prompt" || field === "creator_notes")) return null;
    return (
      <div
        key={field}
        className={cx(styles.block, live !== null && styles.blockWriting, changed !== undefined && styles.blockChange)}
      >
        <div className={styles.blockHead}>
          <span>{fieldLabel(field)}</span>
          {live !== null ? (
            <span>{t("workbench.preview.writing")}</span>
          ) : changed !== undefined ? (
            <span>{t("workbench.status.changes")}</span>
          ) : text ? (
            <span>{t("workbench.preview.chars", { n: [...text].length })}</span>
          ) : null}
        </div>
        {text.trim() || live !== null ? (
          <div className={cx(styles.blockText, live !== null && chat.caret, live === null && styles.clamp)}>{text}</div>
        ) : (
          <div className={styles.blockEmpty}>{t("workbench.preview.empty")}</div>
        )}
      </div>
    );
  };

  const nameLive = writing?.target === "field:name" ? writing.text : null;
  const name = nameLive ?? pending.fields.get("name") ?? card.name;
  return (
    <>
      <button
        type="button"
        className={cx(styles.cover, !draft.cover_blob_id && styles.coverEmpty)}
        onClick={onOpenCover}
        aria-label={t("workbench.cover.change")}
      >
        {draft.cover_blob_id ? (
          <BlobImage blobId={draft.cover_blob_id} alt="" />
        ) : (
          <>
            <Icon name="image" size={16} />
            {t("workbench.cover.title")}
          </>
        )}
        {draft.cover_blob_id ? <span className={styles.coverChange}>{t("workbench.cover.change")}</span> : null}
      </button>
      <div className={styles.nameRow}>
        <span className={cx(styles.name, nameLive !== null && chat.caret)}>{name || t("workbench.home.untitled")}</span>
        {draft.name && draft.name !== name ? <span className={styles.displayName}>{draft.name}</span> : null}
      </div>
      {card.tags.length ? (
        <div className={styles.tags}>
          {card.tags.map((tag) => (
            <Pill key={tag} label={tag} tone="card" />
          ))}
        </div>
      ) : null}
      {TEXT_FIELDS.map(block)}
      {card.alternate_greetings.length ? (
        <div className={styles.block}>
          <div className={styles.blockHead}>
            <span>{t("workbench.preview.greetings", { count: card.alternate_greetings.length })}</span>
          </div>
          <div className={styles.list}>
            {card.alternate_greetings.map((greeting, i) => (
              <div key={i} className={cx(styles.listItem, styles.clamp)}>
                <strong>{i + 1}</strong>
                {greeting}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className={cx(styles.block, writingLore !== null && styles.blockWriting)}>
        <div className={styles.blockHead}>
          <span>{t("workbench.preview.entries", { count: card.book.length })}</span>
          {writingLore !== null ? <span>{t("workbench.preview.writing")}</span> : null}
          {pending.others ? <span className={styles.ok}>{t("workbench.status.changes")}</span> : null}
        </div>
        {card.book.length || writingLore !== null ? (
          <div className={styles.list}>
            {card.book.map((entry, i) => (
              <div key={`${entry.name}:${i}`} className={styles.listItem}>
                <strong>{entry.name || entry.keys[0] || "—"}</strong>
                {entry.content.slice(0, 80)}
                {entry.content.length > 80 ? "…" : ""}
              </div>
            ))}
            {writingLore !== null && writing ? (
              <div className={cx(styles.listItem, chat.caret)}>
                <strong>{writingLore}</strong>
                {writing.text.slice(-160)}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.blockEmpty}>{t("workbench.preview.empty")}</div>
        )}
      </div>
      {state.draft.issues.length ? <IssueList issues={state.draft.issues} /> : null}
    </>
  );
}

function NotesTab({ state }: { state: WorkbenchState }) {
  const { t } = useTranslation();
  const notes = state.draft.notes;
  if (!notes.length) return <div className={styles.empty}>{t("workbench.preview.noNotes")}</div>;
  return (
    <>
      {notes.map((note) => (
        <div key={note.id} className={styles.note}>
          <div className={styles.noteHead}>
            <a className={styles.noteTitle} href={note.url} target="_blank" rel="noreferrer noopener">
              {note.title || note.url}
            </a>
            <span className={styles.noteSite}>{note.site}</span>
          </div>
          <div className={styles.noteText}>{note.text}</div>
          {note.used_in.length ? (
            <div className={styles.usedIn}>
              <Pill label={t("workbench.preview.usedIn", { fields: fieldList(note.used_in) })} tone="acc" />
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

function ImagesTab({ state, cover }: { state: WorkbenchState; cover: CoverActions }) {
  const { t } = useTranslation();
  const assets = state.draft.assets;
  if (!assets.length) return <div className={styles.empty}>{t("workbench.preview.noImages")}</div>;
  return (
    <div className={chat.images}>
      {assets.map((asset) => (
        <AssetTile
          key={asset.id}
          asset={asset}
          selected={state.draft.cover_asset_id === asset.id}
          label={t("workbench.messages.useAsCover")}
          onClick={() => void cover.pick(asset)}
        />
      ))}
    </div>
  );
}

export function PreviewPane({
  state,
  cover,
  onOpenCover,
}: {
  state: WorkbenchState;
  cover: CoverActions;
  onOpenCover: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("card");
  const errors = state.draft.issues.filter((i) => i.level === "error").length;
  const warnings = state.draft.issues.length - errors;
  const pending = pendingFields(state).total;
  const running = state.agentStatus === "running";

  const status = running && state.writing ? (
    <span className={cx(styles.headStatus, styles.writing)}>
      <span className={styles.statusDot} />
      {t("workbench.preview.writing")}
    </span>
  ) : pending ? (
    <span className={cx(styles.headStatus, styles.ok)}>{t("workbench.status.changes")}</span>
  ) : errors ? (
    <span className={cx(styles.headStatus, styles.err)}>{t("workbench.preview.issues", { count: errors })}</span>
  ) : warnings ? (
    <span className={cx(styles.headStatus, styles.warnText)}>{t("workbench.preview.warnings", { count: warnings })}</span>
  ) : (
    <span className={cx(styles.headStatus, styles.ok)}>{t("workbench.preview.checkOk")}</span>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: "card", label: t("workbench.preview.tabs.card") },
    {
      key: "notes",
      label: state.draft.notes.length
        ? `${t("workbench.preview.tabs.notes")} ${state.draft.notes.length}`
        : t("workbench.preview.tabs.notes"),
    },
    {
      key: "images",
      label: state.draft.assets.length
        ? `${t("workbench.preview.tabs.images")} ${state.draft.assets.length}`
        : t("workbench.preview.tabs.images"),
    },
  ];
  return (
    <>
      <div className={styles.head}>
        <span className={styles.headTitle}>{t(`workbench.preview.${tab === "card" ? "title" : tab}`)}</span>
        {tab === "card" ? status : null}
        <div className={styles.tabs} role="tablist" aria-label={t("workbench.preview.title")}>
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={cx(styles.tab, tab === item.key && styles.tabOn)}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.scroll} role="tabpanel">
        {tab === "card" ? <CardTab state={state} onOpenCover={onOpenCover} /> : null}
        {tab === "notes" ? <NotesTab state={state} /> : null}
        {tab === "images" ? <ImagesTab state={state} cover={cover} /> : null}
      </div>
    </>
  );
}
