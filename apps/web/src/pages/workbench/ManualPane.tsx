/**
 * 手动模式（W06，同 App 的 src/features/workbench/ManualPane.tsx）：左边分节目录（点一下滚过去，滚动时跟着亮），
 * 中间是表单：封面、基本、角色、情境与开场、备选开场白、说话方式、系统提示与作者备注、世界书。
 * 每次修改自动保存（useCardForm）。“没填”一类的问题在点保存之前不标红，其他问题改的时候就标出来。
 * 右栏的检查（CheckPanel）：问题清单（点一下滚到那一节）、字数、开场在阅读页里的样子。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Draft, Issue } from "@bettertavern/core/api/types";
import {
  CARD_LIMITS,
  charCount,
  EMPTY_CODES,
  fieldLabel,
  issueProblem,
  moveItem,
  newGreeting,
  TEXT_FIELDS,
  type CardDraft,
  type TextField,
} from "@bettertavern/core/scenario/cardEdit";

import { Button, cx, Field, IconButton, Notice, TextArea } from "../../components/controls.tsx";
import { BlobImage } from "./assets.tsx";
import { BookEditor } from "./BookEditor.tsx";
import edit from "./edit.module.css";
import styles from "./manual.module.css";
import { IssueList } from "./PreviewPane.tsx";
import preview from "./preview.module.css";
import type { CardForm } from "./useCardForm.ts";

const SECTIONS = ["cover", "basic", "character", "opening", "greetings", "speech", "advanced", "book"] as const;
type Section = (typeof SECTIONS)[number];

/** 问题落在哪一节 */
function sectionOf(field: string): Section {
  if (field.startsWith("book")) return "book";
  if (field.startsWith("alternate_greetings")) return "greetings";
  if (field === "description" || field === "personality") return "character";
  if (field === "scenario" || field === "first_mes") return "opening";
  if (field === "mes_example") return "speech";
  if (field === "system_prompt" || field === "creator_notes") return "advanced";
  return "basic";
}

const anchorId = (section: Section): string => `wb-${section}`;

export function scrollToIssue(issue: Issue): void {
  document.getElementById(anchorId(sectionOf(issue.field)))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 字数到上限的八成时开始显示 */
function lengthHint(text: string, limit: number): string | undefined {
  const n = charCount(text);
  return n >= limit * 0.8 ? `${n} / ${limit}` : undefined;
}

export function ManualPane({
  form: state,
  draft,
  showEmpty,
  onOpenCover,
}: {
  form: CardForm;
  draft: Draft;
  /** 点过保存：“没填”的问题也标红 */
  showEmpty: boolean;
  onOpenCover: () => void;
}) {
  const { t } = useTranslation();
  const { form, update, issues } = state;
  const scroller = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<Section>("cover");

  // 滚动时目录跟着亮：最上面露出来的那一节
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        const first = SECTIONS.find((s) => seen.get(anchorId(s)));
        if (first) setCurrent(first);
      },
      { root, rootMargin: "0px 0px -60% 0px" },
    );
    for (const section of SECTIONS) {
      const el = document.getElementById(anchorId(section));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [form !== null]);

  if (!form) return null;

  const errorFor = (field: string): string | null => {
    const issue = issues.find((i) => i.field === field && i.level === "error" && (showEmpty || !EMPTY_CODES.has(i.code)));
    return issue ? issueProblem(issue) : null;
  };
  const set = (patch: Partial<CardDraft>): void => update(patch);

  const textField = (field: TextField, height: number, hint?: string) => (
    <TextArea
      label={fieldLabel(field)}
      optional
      height={height}
      value={form[field]}
      onChange={(e) => set({ [field]: e.target.value } as Partial<CardDraft>)}
      hint={lengthHint(form[field], CARD_LIMITS.field) ?? hint}
      error={errorFor(field)}
    />
  );

  const heading = (section: Section, meta?: string) => (
    <div id={anchorId(section)} className={cx(edit.sectionRow, styles.anchor)}>
      <h2 className={edit.section}>{t(`cardEdit.sections.${section}`)}</h2>
      {meta ? <span className={edit.sectionMeta}>{meta}</span> : null}
    </div>
  );

  const greetings = form.greetings;
  const setGreeting = (index: number, text: string): void =>
    set({ greetings: greetings.map((g, i) => (i === index ? { ...g, text } : g)) });

  return (
    <div className={styles.manual}>
      <nav className={styles.nav} aria-label={t("workbench.modes.manual")}>
        {SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            className={cx(styles.navItem, current === section && styles.navOn)}
            aria-current={current === section ? "true" : undefined}
            onClick={() =>
              document.getElementById(anchorId(section))?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <span>{t(`cardEdit.sections.${section}`)}</span>
            {section === "book" ? <span className={styles.navCount}>{form.book.length}</span> : null}
            {section === "greetings" && greetings.length ? (
              <span className={styles.navCount}>{greetings.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div ref={scroller} className={styles.form}>
        <div className={styles.formInner}>
          {heading("cover")}
          <div className={styles.coverRow}>
            {draft.draft.cover_blob_id ? (
              <BlobImage blobId={draft.draft.cover_blob_id} alt="" className={styles.coverThumb} />
            ) : (
              <span className={styles.coverThumb} />
            )}
            <div className={styles.coverBody}>
              {draft.draft.cover_blob_id ? null : <span>{t("workbench.cover.none")}</span>}
              <div>
                <Button label={t("workbench.cover.change")} icon="image" variant="secondary" size="sm" onClick={onOpenCover} />
              </div>
            </div>
          </div>

          {heading("basic")}
          <Field
            label={fieldLabel("display_name")}
            optional
            value={form.displayName}
            maxLength={CARD_LIMITS.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            hint={t("cardEdit.hints.displayName")}
            error={errorFor("display_name")}
          />
          <Field
            label={fieldLabel("name")}
            value={form.name}
            maxLength={CARD_LIMITS.name}
            onChange={(e) => set({ name: e.target.value })}
            hint={t("cardEdit.hints.name", { char: "{{char}}" })}
            error={errorFor("name")}
          />
          <Field
            label={fieldLabel("tags")}
            optional
            value={form.tags}
            onChange={(e) => set({ tags: e.target.value })}
            hint={t("cardEdit.hints.list")}
            error={errorFor("tags")}
          />

          {heading("character")}
          {textField("description", 180, t("cardEdit.hints.description"))}
          {textField("personality", 110)}

          {heading("opening")}
          {textField("scenario", 120, t("cardEdit.hints.scenario"))}
          {textField("first_mes", 160, t("cardEdit.hints.first_mes"))}

          {heading("greetings", greetings.length ? t("cardEdit.entries", { count: greetings.length }) : undefined)}
          <p className={edit.note}>{t("cardEdit.hints.greetings")}</p>
          {errorFor("alternate_greetings") ? <Notice message={errorFor("alternate_greetings")} /> : null}
          {greetings.map((greeting, i) => (
            <div key={greeting.key} className={styles.greeting}>
              <TextArea
                label={t("cardEdit.greetingLabel", { n: i + 1 })}
                height={110}
                value={greeting.text}
                onChange={(e) => setGreeting(i, e.target.value)}
                error={errorFor(`alternate_greetings.${i}`)}
              />
              <div className={styles.greetingTools}>
                <IconButton
                  icon="chevronUp"
                  label={t("cardEdit.moveUp")}
                  tone="plain"
                  diameter={32}
                  iconSize={16}
                  disabled={i === 0}
                  onClick={() => set({ greetings: moveItem(greetings, i, -1) })}
                />
                <IconButton
                  icon="chevronDown"
                  label={t("cardEdit.moveDown")}
                  tone="plain"
                  diameter={32}
                  iconSize={16}
                  disabled={i === greetings.length - 1}
                  onClick={() => set({ greetings: moveItem(greetings, i, 1) })}
                />
                <IconButton
                  icon="trash"
                  label={t("cardEdit.removeGreeting")}
                  tone="plain"
                  diameter={32}
                  iconSize={16}
                  onClick={() => set({ greetings: greetings.filter((_, j) => j !== i) })}
                />
              </div>
            </div>
          ))}
          <div>
            <Button
              label={t("cardEdit.addGreeting")}
              icon="plus"
              variant="secondary"
              size="sm"
              disabled={greetings.length >= CARD_LIMITS.greetings}
              onClick={() => set({ greetings: [...greetings, newGreeting()] })}
            />
          </div>

          {heading("speech")}
          {textField("mes_example", 150, t("cardEdit.hints.mes_example"))}

          {heading("advanced")}
          {textField("system_prompt", 100, t("cardEdit.hints.system_prompt"))}
          {textField("creator_notes", 100, t("cardEdit.hints.creator_notes"))}

          {heading("book", t("cardEdit.entries", { count: form.book.length }))}
          <p className={edit.note}>{t("cardEdit.bookNote")}</p>
          {errorFor("book") ? <Notice message={errorFor("book")} /> : null}
          <BookEditor book={form.book} onChange={(book) => set({ book })} errorFor={errorFor} />
        </div>
      </div>
    </div>
  );
}

/** 手动模式的右栏：检查、字数、开场在阅读页里的样子 */
export function CheckPanel({ form }: { form: CardForm }) {
  const { t } = useTranslation();
  const card = form.form;
  if (!card) return null;
  const lengths = TEXT_FIELDS.filter((f) => card[f].trim())
    .map((f) => `${fieldLabel(f)} ${charCount(card[f].trim())}`)
    .join(" · ");
  const name = card.name.trim();
  const opening = name ? card.first_mes.replace(/\{\{\s*char\s*\}\}/gi, name) : card.first_mes;
  return (
    <>
      <div className={preview.head}>
        <span className={preview.headTitle}>{t("workbench.preview.check")}</span>
      </div>
      <div className={styles.sideScroll}>
        <div className={preview.check}>
          {form.issues.length ? (
            <IssueList issues={form.issues} onPick={scrollToIssue} />
          ) : (
            <div className={preview.okLine}>{t("workbench.preview.checkOk")}</div>
          )}
          {lengths ? (
            <div className={preview.block}>
              <div className={preview.blockHead}>{t("workbench.preview.lengths")}</div>
              <div className={preview.stats}>{lengths}</div>
            </div>
          ) : null}
        </div>
        {opening.trim() ? (
          <>
            <h3 className={preview.sectionTitle}>{t("workbench.preview.openingPreview")}</h3>
            <div className={preview.opening}>{opening.trim()}</div>
          </>
        ) : null}
        <p className={preview.footnote}>{t("cardEdit.notice", { user: "{{user}}", char: "{{char}}" })}</p>
      </div>
    </>
  );
}
