/**
 * “剧本”“角色”两页的部件：页头的工具条（搜索、排序、网格/表格、主按钮）、网格卡片、表格、空状态，
 * 以及搜索和排序的纯函数。卡片和表格的一行都指向详情（剧本详情或角色卡详情）；悬停出现“…”，右键打开同一个菜单。
 */

import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import type { CardSummary, Scenario } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { formatRelative } from "@bettertavern/core/utils/format";
import { cardOrigin } from "@bettertavern/core/workbench/labels";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, IconButton } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import type { MenuPlace } from "../../overlay/Menu.tsx";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import type { LibraryView } from "../../state/prefs.ts";
import styles from "./library.module.css";

/** scenarios：剧本；cards：角色（角色卡） */
export type Kind = "scenarios" | "cards";

export type SortKey = "recent" | "name";

/** 一格或表格的一行（剧本和角色卡共用） */
export type Item = {
  id: string;
  to: string;
  title: string;
  summary: string;
  meta?: string;
  coverBlobId: string | null;
  updatedAt: string;
  /** 表格里名字和修改时间之间的几列（顺序同 columnLabels） */
  cells: string[];
  /** 搜索时也看这些字（标签、角色卡的名字） */
  keywords: string;
  menu: (place: MenuPlace) => void;
};

export function scenarioItem(s: Scenario, to: string): Omit<Item, "menu"> {
  const names = s.cards.map((c) => c.name).join(i18n.t("common.listSeparator"));
  const cast = s.cards.length > 1 ? names : "";
  return {
    id: s.id,
    to,
    title: s.name,
    summary: s.description_preview || cast,
    meta: s.cards.length > 1 ? i18n.t("library.cardsIn", { count: s.cards.length }) : undefined,
    coverBlobId: s.cover_blob_id,
    updatedAt: s.updated_at,
    cells: [names, s.description_preview],
    keywords: names,
  };
}

export function cardItem(c: CardSummary, to: string): Omit<Item, "menu"> {
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
    updatedAt: c.updated_at,
    cells: [
      cardOrigin(c),
      c.book_entries ? i18n.t("library.loreCount", { count: c.book_entries }) : "–",
      c.scenario_count ? i18n.t("library.usedBy", { count: c.scenario_count }) : "–",
    ],
    keywords: [c.character_name, c.creator, ...c.tags].join(" "),
  };
}

/** 表格名字和修改时间之间那几列的标题 */
export function columnLabels(kind: Kind): string[] {
  return kind === "cards"
    ? [i18n.t("library.columns.source"), i18n.t("library.columns.lore"), i18n.t("library.columns.usedBy")]
    : [i18n.t("library.columns.cards"), i18n.t("library.columns.summary")];
}

/** 名字、简介、关键词里含有搜索的字（不分大小写）；没输入时都算 */
export function matches(item: Pick<Item, "title" | "summary" | "keywords">, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.summary, item.keywords].some((text) => text.toLowerCase().includes(q));
}

/** recent：修改时间新的在前；name：按名字（当前界面语言的排序规则） */
export function sortItems<T extends Pick<Item, "title" | "updatedAt">>(items: T[], sort: SortKey): T[] {
  const sorted = [...items];
  if (sort === "name") sorted.sort((a, b) => a.title.localeCompare(b.title, i18n.language));
  else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sorted;
}

/** 封面的宽高比：96 × 76 */
export function coverHeight(width: number): number {
  return (width * 76) / 96;
}

export function Toolbar({
  kind,
  search,
  onSearch,
  sort,
  onSort,
  view,
  onView,
  addLabel,
  addIcon,
  onAdd,
  labelled,
}: {
  kind: Kind;
  search: string;
  onSearch: (value: string) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  addLabel: string;
  addIcon: IconName;
  onAdd: () => void;
  /** 宽屏：主按钮是带文字的胶囊 */
  labelled: boolean;
}) {
  const { t } = useTranslation();
  const option = (value: LibraryView, icon: IconName, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === value}
      aria-label={label}
      data-tip={label}
      className={cx(styles.segButton, view === value && styles.segOn)}
      onClick={() => onView(value)}
    >
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <>
      <label className={styles.search}>
        <Icon name="search" size={16} />
        <input
          type="search"
          value={search}
          placeholder={kind === "cards" ? t("library.searchCards") : t("library.searchScenarios")}
          aria-label={t("library.search")}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <select
        className={styles.sort}
        value={sort}
        aria-label={t("library.sort.label")}
        onChange={(e) => onSort(e.target.value as SortKey)}
      >
        <option value="recent">{t("library.sort.recent")}</option>
        <option value="name">{t("library.sort.name")}</option>
      </select>
      <div role="radiogroup" aria-label={t("library.view")} className={styles.seg}>
        {option("grid", "grid", t("library.grid"))}
        {option("list", "list", t("library.table"))}
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

/** 表格：名字（带小封面）、各自的几列、修改时间、“…”。点一行进详情 */
export function ItemTable({ kind, items }: { kind: Kind; items: Item[] }) {
  const { t } = useTranslation();
  const labels = columnLabels(kind);
  return (
    <table className={cx(styles.table, kind === "cards" ? styles.cardsTable : styles.scenariosTable)}>
      <thead>
        <tr>
          <th scope="col">{t("library.columns.name")}</th>
          {labels.map((label) => (
            <th key={label} scope="col">
              {label}
            </th>
          ))}
          <th scope="col">{t("library.columns.updated")}</th>
          <th scope="col">
            <span className={styles.srOnly}>{t("library.columns.actions")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <TableRow key={item.id} item={item} />
        ))}
      </tbody>
    </table>
  );
}

function TableRow({ item }: { item: Item }) {
  const navigate = useNavigate();
  const more = useRef<HTMLButtonElement>(null);
  const context = useContextMenu(item.menu);
  const { t } = useTranslation();
  return (
    <tr
      className={styles.tr}
      {...context}
      onClick={(event) => {
        // 点在链接、按钮上时交给它们自己
        if ((event.target as HTMLElement).closest("a, button")) return;
        navigate(item.to);
      }}
    >
      <td>
        <Link to={item.to} className={styles.nameCell}>
          <Cover seed={item.id} blobId={item.coverBlobId} width={36} height={36} surface="onFill" rounded={10} />
          <span className={styles.nameText}>{item.title}</span>
        </Link>
      </td>
      {item.cells.map((cell, i) => (
        <td key={i} className={styles.dim}>
          <span className={styles.clip}>{cell || "–"}</span>
        </td>
      ))}
      <td className={styles.dim}>{formatRelative(item.updatedAt)}</td>
      <td className={styles.moreCell}>
        <IconButton
          ref={more}
          icon="more"
          label={t("nav.moreFor", { title: item.title })}
          tone="plain"
          diameter={32}
          iconSize={18}
          className={styles.tableMore}
          onClick={() => more.current && item.menu({ anchor: more.current })}
        />
      </td>
    </tr>
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
