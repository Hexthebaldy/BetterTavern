/**
 * 手动模式（同网页端 pages/workbench/ManualPane.tsx）：顶上一排分节的标签（点一下滚过去），下面是表单：
 * 封面、基本、角色、情境与开场、备选开场白、说话方式、系统提示与作者备注、世界书。
 * 每次修改自动保存（useCardForm）。“没填”一类的问题在点保存之前不标红，其他问题改的时候就标出来。
 * 检查结果、字数和开场的样子在预览面板里（CheckBody）。
 */

import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import type { Draft, Issue } from "@bettertavern/core/api/types";
import {
  CARD_LIMITS,
  charCount,
  EMPTY_CODES,
  fieldLabel,
  issueProblem,
  moveItem,
  newGreeting,
  type CardDraft,
  type TextField,
} from "@bettertavern/core/scenario/cardEdit";

import { Button, Chip, Field, IconButton, Notice, SectionHeader, useColumnStyle } from "../../components/ui.tsx";
import { comicRadius, comicStroke, space, useComic } from "../../theme/index.ts";
import { BlobImage } from "./assets.tsx";
import { BookEditor } from "./BookEditor.tsx";
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

function lengthHint(text: string, limit: number): string | undefined {
  const n = charCount(text);
  return n >= limit * 0.8 ? `${n} / ${limit}` : undefined;
}

export type ManualPaneHandle = { scrollToIssue: (issue: Issue) => void };

export const ManualPane = forwardRef<
  ManualPaneHandle,
  { form: CardForm; draft: Draft; showEmpty: boolean; onOpenCover: () => void; bottomInset: number }
>(function ManualPane({ form: state, draft, showEmpty, onOpenCover, bottomInset }, ref) {
  const c = useComic();
  const { t } = useTranslation();
  const column = useColumnStyle();
  const { form, update, issues } = state;
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef(new Map<Section, number>());

  const jump = (section: Section): void => {
    const y = offsets.current.get(section);
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - space.s), animated: true });
  };
  useImperativeHandle(ref, () => ({ scrollToIssue: (issue) => jump(sectionOf(issue.field)) }), []);

  if (!form) return null;

  const errorFor = (field: string): string | null => {
    const issue = issues.find(
      (i) => i.field === field && i.level === "error" && (showEmpty || !EMPTY_CODES.has(i.code)),
    );
    return issue ? issueProblem(issue) : null;
  };

  const textField = (field: TextField, boxHeight: number, hint?: string) => (
    <Field
      label={fieldLabel(field)}
      optional
      multiline
      boxHeight={boxHeight}
      value={form[field]}
      onChangeText={(value) => update({ [field]: value } as Partial<CardDraft>)}
      hint={lengthHint(form[field], CARD_LIMITS.field) ?? hint}
      error={errorFor(field)}
    />
  );

  const heading = (section: Section, meta?: string) => (
    <View onLayout={(e) => offsets.current.set(section, e.nativeEvent.layout.y)}>
      <SectionHeader title={t(`cardEdit.sections.${section}`)} meta={meta} style={styles.section} />
    </View>
  );

  const greetings = form.greetings;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.jumps}
      >
        {SECTIONS.map((section) => (
          <Chip key={section} small label={t(`cardEdit.sections.${section}`)} onPress={() => jump(section)} />
        ))}
      </ScrollView>
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.content, column, { paddingBottom: bottomInset + 56 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {heading("cover")}
        <View style={styles.coverRow}>
          {draft.draft.cover_blob_id ? (
            <BlobImage blobId={draft.draft.cover_blob_id} style={[styles.coverThumb, { backgroundColor: c.grey, borderColor: c.ink }]} />
          ) : (
            <View style={[styles.coverThumb, { backgroundColor: c.grey, borderColor: c.ink }]} />
          )}
          <View style={{ flex: 1, gap: space.s }}>
            {draft.draft.cover_blob_id ? null : (
              <Text style={{ fontSize: 13, color: c.mut }}>{t("workbench.cover.none")}</Text>
            )}
            <Button
              label={t("workbench.cover.change")}
              icon="image"
              variant="secondary"
              onPress={onOpenCover}
              small
              style={{ alignSelf: "flex-start" }}
            />
          </View>
        </View>

        {heading("basic")}
        <Field
          label={fieldLabel("display_name")}
          optional
          value={form.displayName}
          maxLength={CARD_LIMITS.displayName}
          onChangeText={(displayName) => update({ displayName })}
          hint={t("cardEdit.hints.displayName")}
          error={errorFor("display_name")}
        />
        <Field
          label={fieldLabel("name")}
          value={form.name}
          maxLength={CARD_LIMITS.name}
          onChangeText={(name) => update({ name })}
          hint={t("cardEdit.hints.name", { char: "{{char}}" })}
          error={errorFor("name")}
        />
        <Field
          label={fieldLabel("tags")}
          optional
          value={form.tags}
          onChangeText={(tags) => update({ tags })}
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
        <Text style={[styles.note, { color: c.mut }]}>{t("cardEdit.hints.greetings")}</Text>
        {errorFor("alternate_greetings") ? <Notice message={errorFor("alternate_greetings") ?? ""} /> : null}
        {greetings.map((greeting, i) => (
          <View key={greeting.key} style={{ gap: 4 }}>
            <Field
              label={t("cardEdit.greetingLabel", { n: i + 1 })}
              multiline
              boxHeight={110}
              value={greeting.text}
              onChangeText={(text) =>
                update({ greetings: greetings.map((g, j) => (j === i ? { ...g, text } : g)) })
              }
              error={errorFor(`alternate_greetings.${i}`)}
            />
            <View style={styles.greetingTools}>
              <IconButton
                icon="chevronUp"
                label={t("cardEdit.moveUp")}
                tone="plain"
                diameter={32}
                size={16}
                disabled={i === 0}
                onPress={() => update({ greetings: moveItem(greetings, i, -1) })}
              />
              <IconButton
                icon="chevronDown"
                label={t("cardEdit.moveDown")}
                tone="plain"
                diameter={32}
                size={16}
                disabled={i === greetings.length - 1}
                onPress={() => update({ greetings: moveItem(greetings, i, 1) })}
              />
              <IconButton
                icon="trash"
                label={t("cardEdit.removeGreeting")}
                tone="plain"
                diameter={32}
                size={16}
                onPress={() => update({ greetings: greetings.filter((_, j) => j !== i) })}
              />
            </View>
          </View>
        ))}
        <Button
          label={t("cardEdit.addGreeting")}
          icon="plus"
          variant="secondary"
          disabled={greetings.length >= CARD_LIMITS.greetings}
          onPress={() => update({ greetings: [...greetings, newGreeting()] })}
          small
          style={{ alignSelf: "flex-start" }}
        />

        {heading("speech")}
        {textField("mes_example", 150, t("cardEdit.hints.mes_example"))}

        {heading("advanced")}
        {textField("system_prompt", 100, t("cardEdit.hints.system_prompt"))}
        {textField("creator_notes", 100, t("cardEdit.hints.creator_notes"))}

        {heading("book", t("cardEdit.entries", { count: form.book.length }))}
        <Text style={[styles.note, { color: c.mut }]}>{t("cardEdit.bookNote")}</Text>
        {errorFor("book") ? <Notice message={errorFor("book") ?? ""} /> : null}
        <BookEditor book={form.book} onChange={(book) => update({ book })} errorFor={errorFor} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  jumps: { paddingHorizontal: space.l, paddingVertical: space.s, gap: 6 },
  content: { paddingHorizontal: space.page, paddingTop: space.s, gap: space.m },
  /** 内容已经有左右边距，小标题不再缩进 */
  section: { paddingHorizontal: 0, paddingBottom: 0, paddingTop: space.l },
  note: { fontSize: 13, lineHeight: 20, marginTop: -space.s },
  coverRow: { flexDirection: "row", alignItems: "center", gap: space.l },
  coverThumb: { width: 84, height: 126, borderRadius: comicRadius.cover, borderWidth: comicStroke.control },
  greetingTools: { flexDirection: "row", justifyContent: "flex-end", gap: 4 },
});
