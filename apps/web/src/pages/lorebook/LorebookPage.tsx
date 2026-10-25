/**
 * 世界书详情（/lorebook/:id，docs/lorebook.md 第 9.1 节）：≥ 900 两栏各自滚动，更窄单栏。
 * - 左栏：返回、书名（点“改名”改）、来源、简介（失焦时保存）、三个数字格（条目、常驻、停用）、
 *   导入报告（琥珀色提示：丢掉了几条、哪些设置不支持）、挂着它的剧本、删除；
 * - 右栏：条目编辑（BookEditor，和工作台里卡自带的世界书同一个），顶上是保存状态和搜索框；改了自动保存。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { LorebookDetail } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { issueProblem } from "@bettertavern/core/scenario/cardEdit";
import { bookStats, checkBook, LOREBOOK_LIMITS, reportLines } from "@bettertavern/core/scenario/lorebook";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Button, cx, Dots, IconButton, Notice, TextArea } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { HeaderSearch } from "../../components/PageHeader.tsx";
import { lorebookKey, lorebooksKey, useLorebookActions } from "../../data/lorebooks.ts";
import { scenarioPath } from "../../data/scenarioActions.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { desktop } from "../../theme/layout.ts";
import { BookEditor } from "../workbench/BookEditor.tsx";
import type { AutosaveStatus } from "../workbench/useCardForm.ts";
import styles from "./lorebook.module.css";
import { useLorebookForm } from "./useLorebookForm.ts";

function statusText(status: AutosaveStatus): string {
  if (status.kind === "pending" || status.kind === "saving") return i18n.t("workbench.header.autosaving");
  if (status.kind === "saved") return i18n.t("workbench.header.autosaved");
  if (status.kind === "failed") return i18n.t("workbench.header.autosaveFailed", { error: status.error });
  return "";
}

function DeleteButton({ detail }: { detail: LorebookDetail }) {
  const { t } = useTranslation();
  const actions = useLorebookActions();
  return (
    <div className={styles.danger}>
      <Button
        label={t("lorebook.delete")}
        variant="danger"
        icon="trash"
        onClick={() => void actions.remove({ ...detail.lorebook, scenario_count: detail.scenarios.length })}
      />
    </div>
  );
}

/** 左栏（窄屏时在条目上面）；删除按钮宽屏时在左栏底部，窄屏时放在整页最后 */
function Info({ detail, withDelete }: { detail: LorebookDetail; withDelete: boolean }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const actions = useLorebookActions();
  const book = detail.lorebook;
  const [description, setDescription] = useState(book.description);
  useEffect(() => setDescription(book.description), [book.description]);
  const stats = bookStats(detail.book);
  const lines = reportLines(book.report);

  const saveDescription = async (): Promise<void> => {
    const text = description.trim();
    if (text === book.description) return;
    try {
      const next = await api.lorebooks.update(book.id, { description: text });
      queries.setQueryData(lorebookKey(book.id), next);
      void queries.invalidateQueries({ queryKey: lorebooksKey });
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  return (
    <>
      <div className={styles.topBar}>
        <IconButton icon="back" label={t("lorebook.back")} onClick={() => navigate("/lorebooks")} />
      </div>
      <div className={styles.titleBlock}>
        <span className={styles.caption}>
          {[t(`lorebook.source.${book.source}`), formatRelative(book.updated_at)].join(" · ")}
        </span>
        <div className={styles.titleRow}>
          <h1 className={styles.hero}>{book.name}</h1>
          <Button label={t("lorebook.rename")} icon="write" variant="secondary" size="sm" onClick={() => void actions.rename(book)} />
        </div>
      </div>
      <div className={styles.stats}>
        {(
          [
            ["statEntries", stats.entries],
            ["statConstant", stats.constant],
            ["statDisabled", stats.disabled],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className={styles.stat}>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.caption}>{t(`lorebook.${key}`)}</span>
          </div>
        ))}
      </div>
      <div className={styles.block}>
        <TextArea
          label={t("lorebook.description")}
          height={96}
          value={description}
          maxLength={LOREBOOK_LIMITS.description}
          placeholder={t("lorebook.descriptionPlaceholder")}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => void saveDescription()}
        />
      </div>
      {lines.length ? (
        <div className={styles.block}>
          <Notice
            tone="warn"
            message={
              <>
                <strong>{t("lorebook.reportTitle")}</strong>
                <ul className={styles.report}>
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            }
          />
        </div>
      ) : null}
      <h2 className={styles.sectionLabel}>{t("lorebook.usedByTitle")}</h2>
      <div className={styles.panel}>
        {detail.scenarios.length ? (
          detail.scenarios.map((s) => (
            <Link key={s.id} to={scenarioPath(s)} className={styles.linkRow}>
              <span>{s.name}</span>
              <Icon name="chevronRight" size={16} />
            </Link>
          ))
        ) : (
          <span className={styles.caption}>{t("lorebook.notUsed")}</span>
        )}
      </div>
      <p className={styles.note}>{t("lorebook.note")}</p>
      {withDelete ? <DeleteButton detail={detail} /> : null}
    </>
  );
}

function Entries({ detail }: { detail: LorebookDetail }) {
  const { t } = useTranslation();
  const form = useLorebookForm(detail.lorebook.id, detail);
  const [search, setSearch] = useState("");
  const issues = useMemo(() => (form.book ? checkBook(form.book) : []), [form.book]);
  if (!form.book) return <Dots />;
  const errorFor = (field: string): string | null => {
    const issue = issues.find((i) => i.field === field && i.level === "error");
    if (issue) return issueProblem(issue);
    return form.serverField === field && form.status.kind === "failed" ? form.status.error : null;
  };
  const bookError = issues.find((i) => i.field === "book");
  return (
    <>
      <div className={styles.entriesBar}>
        <h2 className={styles.entriesTitle}>{t("lorebook.entriesTitle")}</h2>
        <span className={cx(styles.caption, form.status.kind === "failed" && styles.failed)}>
          {statusText(form.status)}
        </span>
        <span className={styles.spacer} />
        <HeaderSearch value={search} onChange={setSearch} placeholder={t("lorebook.searchEntries")} label={t("lorebook.searchEntries")} />
      </div>
      {bookError ? <Notice message={issueProblem(bookError)} /> : null}
      <BookEditor book={form.book} onChange={form.update} errorFor={errorFor} filter={search} />
    </>
  );
}

export function LorebookPage() {
  const { id = "" } = useParams();
  const { api } = useApp();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wide = useWindowWidth() >= desktop.wheel;
  const query = useQuery({ queryKey: lorebookKey(id), queryFn: () => api.lorebooks.get(id) });
  const detail = query.data;
  useDocumentTitle(detail?.lorebook.name ?? t("lorebook.title"));

  if (!detail) {
    return (
      <div className={styles.single}>
        <IconButton icon="back" label={t("lorebook.back")} onClick={() => navigate("/lorebooks")} />
        {query.isPending ? (
          <Dots />
        ) : (
          <Notice
            message={t("lorebook.loadFailedWith", { error: describeError(query.error) })}
            actionLabel={t("common.reload")}
            onAction={() => void query.refetch()}
            className={styles.loadError}
          />
        )}
      </div>
    );
  }

  if (!wide) {
    return (
      <div className={styles.single}>
        <Info detail={detail} withDelete={false} />
        <Entries detail={detail} />
        <DeleteButton detail={detail} />
      </div>
    );
  }
  return (
    <div className={styles.split}>
      <aside className={styles.info}>
        <Info detail={detail} withDelete />
      </aside>
      <section className={styles.entries}>
        <Entries detail={detail} />
      </section>
    </div>
  );
}
