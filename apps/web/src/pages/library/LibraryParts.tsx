/**
 * “剧本”页（W04）的部件：页头的视图切换和加号、两个仓库的切换、网格卡片、列表行、空状态。
 * 卡片和行都是指向详情（剧本详情或角色卡详情）的链接；悬停出现“…”，右键打开同一个菜单。数值同 App 的 LibraryParts.tsx。
 */

import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { CardSummary, Scenario } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { cardOrigin } from "@bettertavern/core/workbench/labels";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, IconButton } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import type { MenuPlace } from "../../overlay/Menu.tsx";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import type { LibraryView } from "../../state/prefs.ts";
import styles from "./library.module.css";

export type LibraryTab = "scenarios" | "cards";

/** 一格的内容（剧本和角色卡共用一种卡片） */
export type Item = {
  id: string;
  to: string;
  title: string;
  summary: string;
  meta?: string;
  coverBlobId: string | null;
};

export function scenarioItem(s: Scenario, to: string): Item {
  const cast = s.cards.length > 1 ? s.cards.map((c) => c.name).join(i18n.t("common.listSeparator")) : "";
  return {
    id: s.id,
    to,
    title: s.name,
    summary: s.description_preview || cast,
    meta: s.cards.length > 1 ? i18n.t("library.cardsIn", { count: s.cards.length }) : undefined,
    coverBlobId: s.cover_blob_id,
  };
}

export function cardItem(c: CardSummary, to: string): Item {
  const meta = [
    cardOrigin(c),
    c.scenario_count ? i18n.t("library.usedBy", { count: c.scenario_count }) : "",
    c.draft_id ? i18n.t("library.unsavedDraft") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: c.id,
    to,
    title: c.name,
    summary: c.description_preview || (c.creator ? i18n.t("library.byCreator", { creator: c.creator }) : ""),
    meta,
    coverBlobId: c.cover_blob_id,
  };
}

/** 封面的宽高比：96 × 76 */
export function coverHeight(width: number): number {
  return (width * 76) / 96;
}

export function Tabs({ tab, onTab, counts }: { tab: LibraryTab; onTab: (tab: LibraryTab) => void; counts: Record<LibraryTab, number | null> }) {
  const { t } = useTranslation();
  return (
    <div role="tablist" aria-label={t("library.tabs.label")} className={styles.tabs}>
      {(["scenarios", "cards"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          className={cx(styles.tab, tab === key && styles.tabOn)}
          onClick={() => onTab(key)}
        >
          {t(`library.tabs.${key}`)}
          {counts[key] !== null ? <span className={styles.tabCount}>{counts[key]}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function HeaderControls({
  view,
  onView,
  addLabel,
  addIcon,
  onAdd,
  labelled,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  addLabel: string;
  addIcon: IconName;
  onAdd: () => void;
  /** 宽屏：加号是带文字的胶囊 */
  labelled: boolean;
}) {
  const { t } = useTranslation();
  const option = (value: LibraryView, icon: IconName, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === value}
      aria-label={label}
      className={cx(styles.segButton, view === value && styles.segOn)}
      onClick={() => onView(value)}
    >
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <>
      <div role="radiogroup" aria-label={t("library.view")} className={styles.seg}>
        {option("grid", "grid", t("library.grid"))}
        {option("list", "list", t("library.list"))}
      </div>
      {labelled ? (
        <Button label={addLabel} icon={addIcon} onClick={onAdd} className={styles.addPill} />
      ) : (
        <IconButton icon={addIcon} label={addLabel} className={styles.add} onClick={onAdd} />
      )}
    </>
  );
}

/** 卡片外壳：链接本身，加上悬停才出现的“…” */
function Frame({
  item,
  className,
  moreClass,
  onMenu,
  children,
}: {
  item: Item;
  className: string | undefined;
  moreClass: string | undefined;
  onMenu: (place: MenuPlace) => void;
  children: ReactNode;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const context = useContextMenu(onMenu);
  const { t } = useTranslation();
  return (
    <div className={styles.cell}>
      <Link to={item.to} className={className} {...context}>
        {children}
      </Link>
      <IconButton
        ref={more}
        icon="more"
        label={t("nav.moreFor", { title: item.title })}
        tone="card"
        diameter={36}
        iconSize={20}
        className={moreClass}
        onClick={() => more.current && onMenu({ anchor: more.current })}
      />
    </div>
  );
}

export function Tile({ item, width, onMenu }: { item: Item; width: number; onMenu: (place: MenuPlace) => void }) {
  const coverWidth = Math.max(0, width - 16);
  return (
    <Frame item={item} className={styles.tile} moreClass={styles.tileMore} onMenu={onMenu}>
      <Cover
        seed={item.id}
        blobId={item.coverBlobId}
        width={coverWidth}
        height={coverHeight(coverWidth)}
        surface="onFill"
        rounded={18}
      />
      <span className={styles.tileMeta}>
        <span className={styles.name}>{item.title}</span>
        <span className={styles.summary}>{item.summary}</span>
        {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
      </span>
    </Frame>
  );
}

export function Row({ item, onMenu }: { item: Item; onMenu: (place: MenuPlace) => void }) {
  return (
    <Frame item={item} className={styles.row} moreClass={styles.rowMore} onMenu={onMenu}>
      <Cover seed={item.id} blobId={item.coverBlobId} width={56} height={56} surface="onFill" />
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowSummary}>{item.summary}</span>
        {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
      </span>
    </Frame>
  );
}

/** 空仓库：一句说明，一个按钮 */
export function Empty({
  title,
  note,
  actionLabel,
  actionIcon,
  onAction,
}: {
  title: string;
  note: string;
  actionLabel: string;
  actionIcon: IconName;
  onAction: () => void;
}) {
  return (
    <div className={styles.emptyWrap}>
      <div className={styles.emptyBody}>
        <h2 className={styles.emptyTitle}>{title}</h2>
        <div className={styles.note}>
          <span className={styles.noteIcon}>
            <Icon name="card" size={18} />
          </span>
          <span>{note}</span>
        </div>
        <Button label={actionLabel} trailingIcon={actionIcon} between onClick={onAction} />
      </div>
    </div>
  );
}
