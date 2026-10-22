/**
 * 角色卡详情（/card/:id，同 App 的 app/card/[id].tsx）：封面、名字、来源和作者、标签；
 * 在工作台里改（有没保存的草稿就打开那一份）、用这张卡新建剧本、导出 PNG / JSON；
 * 描述、开场白和世界书的条数；在用的剧本；参考资料（agent 查过的）；版本历史（可以恢复旧版）；删除（有剧本在用时不能删）。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { CardDetail, CardRevision } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { formatRelative } from "@bettertavern/core/utils/format";
import { cardOrigin, fieldList } from "@bettertavern/core/workbench/labels";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, Dots, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { newScenarioPath, useCardActions } from "../../data/cardActions.ts";
import { scenarioPath } from "../../data/scenarioActions.ts";
import { cardsKey } from "../../data/scenarios.ts";
import { draftPath } from "../../data/workbench.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { shell } from "../../theme/layout.ts";
import styles from "./cards.module.css";

function revisionNote(revision: CardRevision): string {
  const restored = /^restore:(\d+)$/.exec(revision.note);
  if (restored) return i18n.t("cards.restored", { n: Number(restored[1]) });
  return revision.from_draft ? i18n.t("cards.fromDraft") : revision.note;
}

/** 带登录凭据取文件，再让浏览器存下来 */
function useExport(detail: CardDetail | undefined) {
  const { api, authHeaders } = useApp();
  const overlay = useOverlay();
  const { t } = useTranslation();
  return async (format: "png" | "json"): Promise<void> => {
    if (!detail) return;
    try {
      const response = await fetch(api.cards.exportPath(detail.card.id, format), { headers: await authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${detail.card.name || "card"}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      overlay.toast(t("cards.exportFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };
}

export function CardPage() {
  const { id = "" } = useParams();
  const { api } = useApp();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const actions = useCardActions();
  const width = useWindowWidth();
  const query = useQuery({ queryKey: ["card", id], queryFn: () => api.cards.get(id) });
  const revisions = useQuery({ queryKey: ["card", id, "revisions"], queryFn: () => api.cards.revisions(id) });
  const detail = query.data;
  const exportCard = useExport(detail);
  const [opening, setOpening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useDocumentTitle(detail?.card.name ?? t("cards.title"));

  const back = (): void => void navigate("/library?tab=cards");

  if (!detail) {
    return (
      <div className={styles.page}>
        <div>
          <IconButton icon="back" label={t("cards.back")} onClick={back} />
        </div>
        {query.error ? (
          <Notice
            message={t("cards.loadFailed")}
            actionLabel={t("common.reload")}
            onAction={() => void query.refetch()}
          />
        ) : (
          <Dots />
        )}
      </div>
    );
  }

  const { card, content } = detail;
  const coverWidth = Math.min(width - 24, shell.readable);

  const edit = async (): Promise<void> => {
    setOpening(true);
    try {
      await actions.edit(card);
    } finally {
      setOpening(false);
    }
  };

  const restore = async (revision: CardRevision): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("cards.restoreConfirm", { n: revision.version }),
      message: t("cards.restoreMessage"),
      confirmLabel: t("cards.restore"),
      icon: "history",
    });
    if (!ok) return;
    try {
      const restored = await api.cards.restore(card.id, revision.version);
      queries.setQueryData(["card", card.id], restored);
      void queries.invalidateQueries({ queryKey: ["card", card.id, "revisions"] });
      void queries.invalidateQueries({ queryKey: cardsKey });
      overlay.toast(t("cards.restoreDone", { n: revision.version }));
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  // 来源和“谁写的”可能是同一句（agent 写的），只留一次
  const caption = [
    ...new Set([
      cardOrigin(card),
      card.creator ? t("library.byCreator", { creator: card.creator }) : "",
      formatRelative(card.updated_at),
    ]),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.page}>
      <div className={styles.cover}>
        <Cover seed={card.id} blobId={card.cover_blob_id} width={coverWidth} height={Math.round(coverWidth * 0.62)} rounded={34} />
        <div className={styles.coverBar}>
          <IconButton icon="back" label={t("cards.back")} tone="card" diameter={44} onClick={back} />
        </div>
      </div>
      <div className={styles.titleBlock}>
        <span className={styles.caption}>{caption}</span>
        <h1 className={styles.hero}>{card.name}</h1>
        {card.character_name && card.character_name !== card.name ? (
          <span className={styles.caption}>{card.character_name}</span>
        ) : null}
        {card.ip ? <span className={styles.caption}>{t("cards.ip", card.ip)}</span> : null}
        {card.tags.length ? (
          <div className={styles.tags}>
            {card.tags.slice(0, 12).map((tag) => (
              <Pill key={tag} label={tag} />
            ))}
          </div>
        ) : null}
      </div>
      {card.draft_id ? (
        <Notice
          tone="info"
          message={t("library.unsavedDraft")}
          actionLabel={t("common.open")}
          onAction={() => navigate(draftPath(card.draft_id ?? ""))}
        />
      ) : null}
      <div className={styles.actions}>
        <Button label={t("cards.openInWorkbench")} icon="workbench" busy={opening} onClick={() => void edit()} />
        <Button label={t("cards.newScenario")} icon="plus" variant="secondary" onClick={() => navigate(newScenarioPath(card.id))} />
        <Button label={t("cards.exportPng")} icon="share" variant="text" onClick={() => void exportCard("png")} />
        <Button label={t("cards.exportJson")} icon="share" variant="text" onClick={() => void exportCard("json")} />
      </div>

      {content.description.trim() ? (
        <div className={styles.panel}>
          <p className={cx(styles.text, !expanded && styles.clamped)}>{content.description}</p>
          <button type="button" className={styles.more} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("scenario.collapse") : t("scenario.expand")}
          </button>
        </div>
      ) : null}
      <span className={styles.stats}>
        {[
          t("workbench.preview.greetings", { count: card.greetings }),
          t("workbench.preview.entries", { count: card.book_entries }),
        ].join(" · ")}
      </span>

      <h2 className={styles.section}>{t("cards.usedBy")}</h2>
      <div className={styles.panel}>
        {detail.scenarios.length ? (
          detail.scenarios.map((s) => (
            <Link key={s.id} to={scenarioPath(s)} className={styles.linkRow}>
              <span>{s.name}</span>
              <Icon name="chevronRight" size={16} />
            </Link>
          ))
        ) : (
          <span className={styles.caption}>{t("cards.notUsed")}</span>
        )}
      </div>

      {detail.sources.length ? (
        <>
          <h2 className={styles.section}>{t("cards.sources")}</h2>
          <div className={styles.panel}>
            {detail.sources.map((source) => (
              <div key={source.url} className={styles.source}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.title || source.url}
                </a>
                {source.used_in.length ? (
                  <span className={styles.caption}>
                    {t("workbench.preview.usedIn", { fields: fieldList(source.used_in) })}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2 className={styles.section}>{t("cards.revisions")}</h2>
      <div className={styles.panel}>
        {revisions.data ? (
          revisions.data.map((revision) => {
            const current = revision.version === card.version;
            return (
              <div key={revision.version} className={styles.revision}>
                <span className={styles.revisionBody}>
                  <span className={styles.revisionTitle}>
                    {t("cards.version", { n: revision.version })}
                    {current ? ` · ${t("cards.current")}` : ""}
                  </span>
                  <span className={styles.caption}>
                    {[revisionNote(revision), formatRelative(revision.created_at)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {current ? null : (
                  <Button label={t("cards.restore")} variant="secondary" size="sm" onClick={() => void restore(revision)} />
                )}
              </div>
            );
          })
        ) : revisions.error ? (
          <span className={styles.caption}>{describeError(revisions.error)}</span>
        ) : (
          <Dots />
        )}
      </div>

      <div className={styles.danger}>
        <Button label={t("cards.delete")} variant="danger" icon="trash" onClick={() => void actions.remove(card)} />
        <span className={styles.caption}>{t("cards.deleteMessage")}</span>
      </div>
    </div>
  );
}
