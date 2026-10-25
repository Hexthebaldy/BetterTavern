/**
 * 世界书（/lorebooks，docs/lorebook.md 第 9.1 节）：“角色”一级页的另一段，排法同角色卡（4 × 2，翻页）。
 * - 页头：标题、数量和说明；右边是“角色卡 / 世界书”切换、搜索（书名）、新建、导入（选 .json）；
 * - 每本一格：书名的第一个字压在网点底上（同人物位）、左下角墨底书名牌；底下是简介或来源，
 *   和条目数、常驻数、几个剧本在用；有不支持的设置时右上角一个琥珀色小标。右键打开菜单（改名、删除）；
 * - 在这一页把文件拖进窗口，导入的是世界书（别的页面拖进来的照旧当角色卡）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { LorebookSummary } from "@bettertavern/core/api/types";
import { hasUnsupported } from "@bettertavern/core/scenario/lorebook";

import { Portrait } from "../../components/comic.tsx";
import { Pager, usePager } from "../../components/ComicGrid.tsx";
import { buttonClass, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { HeaderSearch, PageHeader } from "../../components/PageHeader.tsx";
import { lorebookPath, useLorebookActions, useLorebookImport, useLorebooks } from "../../data/lorebooks.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import { byRecent } from "../../shell/recent.ts";
import { castPage, castPages } from "../../theme/grid.ts";
import pages from "../pages.module.css";
import { LibraryEmpty } from "./LibraryEmpty.tsx";
import { LibrarySwitch } from "./LibrarySwitch.tsx";
import styles from "./library.module.css";

function matchesBook(book: LorebookSummary, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || book.name.toLocaleLowerCase().includes(q) || book.description.toLocaleLowerCase().includes(q);
}

export function LorebooksPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("lorebook.title"));
  const navigate = useNavigate();
  const books = useLorebooks();
  const actions = useLorebookActions();
  const opened = useCallback((book: LorebookSummary) => navigate(lorebookPath(book.id)), [navigate]);
  const importer = useLorebookImport(opened);
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const all = useMemo(() => (books.data ? byRecent(books.data) : null), [books.data]);
  const list = (all ?? []).filter((b) => matchesBook(b, search));
  const total = list.length;
  const pageCount = castPages(total);
  const [page, setPage] = usePager(pageCount, `${search}|${total}`);
  const shown = castPage(total, page);
  const { importFile } = importer;

  // 这一页把文件拖进窗口导入世界书：先于全局的角色卡导入接住（它看到 defaultPrevented 就不管）
  useEffect(() => {
    const onDrop = (event: DragEvent): void => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
      const [file] = Array.from(event.dataTransfer?.files ?? []);
      if (file) void importFile(file);
    };
    window.addEventListener("drop", onDrop, { capture: true });
    return () => window.removeEventListener("drop", onDrop, { capture: true });
  }, [importFile]);

  let body;
  if (!all) {
    body = books.isPending ? <div className={styles.cast} /> : null;
  } else if (all.length === 0) {
    body = (
      <LibraryEmpty
        title={t("lorebook.empty")}
        note={t("lorebook.emptyNote")}
        actionLabel={t("lorebook.import")}
        actionIcon="import"
        onAction={() => input.current?.click()}
      />
    );
  } else if (total === 0) {
    body = <p className={styles.noMatch}>{t("lorebook.noMatch", { query: search.trim() })}</p>;
  } else {
    body = (
      <>
        <div className={styles.cast} aria-label={t("lorebook.title")}>
          {shown.map((index) => {
            const book = list[index];
            return book ? (
              <BookCard key={book.id} book={book} onMenu={(place) => void actions.menu(book, place)} />
            ) : null;
          })}
        </div>
        <Pager page={page} pages={pageCount} onPage={setPage} summary={t("lorebook.gridHint")} />
      </>
    );
  }

  return (
    <div className={pages.page}>
      <PageHeader title={t("lorebook.title")} count={all ? all.length : null} sub={t("lorebook.sub")}>
        <LibrarySwitch value="lorebooks" />
        <HeaderSearch
          value={search}
          onChange={setSearch}
          placeholder={t("lorebook.searchShort")}
          label={t("lorebook.search")}
        />
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => void actions.create()}>
          <Icon name="plus" size={17} strokeWidth={2.2} />
          {t("lorebook.create")}
        </button>
        <button
          type="button"
          className={buttonClass("blue", "sm")}
          disabled={importer.progress !== null}
          onClick={() => input.current?.click()}
        >
          <Icon name="import" size={17} strokeWidth={2.2} />
          {importer.progress ? t("lorebook.importing", { name: importer.progress }) : t("lorebook.import")}
        </button>
      </PageHeader>
      {importer.problem ? (
        <Notice
          message={
            <>
              <strong>{importer.problem.title}</strong> {importer.problem.message}
            </>
          }
          actionLabel={importer.problem.toWorkbench ? t("lorebook.goWorkbench") : undefined}
          onAction={importer.problem.toWorkbench ? () => navigate("/workbench") : undefined}
          onClose={importer.dismiss}
          className={styles.banner}
        />
      ) : null}
      {books.error ? (
        <Notice
          icon="offline"
          message={all ? describeError(books.error) : t("lorebook.loadFailedWith", { error: describeError(books.error) })}
          actionLabel={all ? t("common.retry") : t("common.reload")}
          onAction={() => void books.refetch()}
          className={styles.banner}
        />
      ) : null}
      {body}
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const [file] = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
    </div>
  );
}

function BookCard({ book, onMenu }: { book: LorebookSummary; onMenu: Parameters<typeof useContextMenu>[0] }) {
  const { t } = useTranslation();
  const context = useContextMenu(onMenu);
  const meta = [
    t("lorebook.entries", { count: book.entries }),
    book.constant ? t("lorebook.constant", { count: book.constant }) : "",
    book.scenario_count ? t("lorebook.usedBy", { count: book.scenario_count }) : "",
  ].filter(Boolean);
  return (
    <div className={styles.castCell}>
      <Link to={lorebookPath(book.id)} className={styles.castCard} {...context}>
        <span className={styles.castPortrait}>
          <Portrait name={book.name} seed={book.id} blobId={null} className={styles.fill} />
          <span className={styles.namePlate}>{book.name}</span>
          {hasUnsupported(book.report) ? (
            <Pill tone="warn" label={t("lorebook.unsupported")} className={styles.draftChip} />
          ) : null}
        </span>
        <span className={styles.castFoot}>
          <span className={styles.castIdentity}>{book.description || t(`lorebook.source.${book.source}`)}</span>
          <span className={styles.castMeta}>{meta.join(" · ")}</span>
        </span>
      </Link>
    </div>
  );
}
