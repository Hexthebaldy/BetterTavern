/**
 * 世界书详情（同网页端 pages/lorebook/LorebookPage.tsx，docs/lorebook.md 第 9.2 节）：
 * 导航栏是返回、书名和“更多”（改名、删除）；来源和时间；条目、常驻、停用三个数字格；简介（失焦时保存）；
 * 导入报告（琥珀色提示）；挂着它的剧本；条目编辑（和工作台里卡自带的世界书同一个 BookEditor），顶上是保存状态和
 * 搜索框，改了自动保存；最后是删除。漫画风：数字格、提示、列表都是墨线的格子。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import { i18n } from "@bettertavern/core/i18n/index";
import { issueProblem } from "@bettertavern/core/scenario/cardEdit";
import { bookStats, checkBook, LOREBOOK_LIMITS, reportLines } from "@bettertavern/core/scenario/lorebook";
import { formatRelative } from "@bettertavern/core/utils/format";

import {
  Button,
  ErrorState,
  Field,
  Group,
  ListRow,
  Loading,
  NavBar,
  Notice,
  Page,
  SectionHeader,
  useOverlay,
} from "../../src/components/ui.tsx";
import { useLorebookActions } from "../../src/features/library/lorebookActions.ts";
import { useLorebookForm } from "../../src/features/lorebook/useLorebookForm.ts";
import { BookEditor } from "../../src/features/workbench/BookEditor.tsx";
import type { AutosaveStatus } from "../../src/features/workbench/useCardForm.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { comicRadius, comicStroke, font, space, useComic } from "../../src/theme/index.ts";

function statusText(status: AutosaveStatus): string {
  if (status.kind === "pending" || status.kind === "saving") return i18n.t("workbench.header.autosaving");
  if (status.kind === "saved") return i18n.t("workbench.header.autosaved");
  if (status.kind === "failed") return i18n.t("workbench.header.autosaveFailed", { error: status.error });
  return "";
}

export default function LorebookScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const overlay = useOverlay();
  const c = useComic();
  const { t } = useTranslation();
  const actions = useLorebookActions();
  const detail = useAsync(() => api.lorebooks.get(id), [api, id]);
  const form = useLorebookForm(id, detail.data, (next) => detail.setData(() => next));
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const savedDescription = detail.data?.lorebook.description ?? "";
  useEffect(() => setDescription(savedDescription), [savedDescription]);
  const issues = useMemo(() => (form.book ? checkBook(form.book) : []), [form.book]);

  if (!detail.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
        <NavBar title={t("lorebook.title")} />
        {detail.loading ? (
          <Loading />
        ) : (
          <ErrorState
            title={t("lorebook.loadFailed")}
            message={describeError(detail.error)}
            onRetry={() => void detail.reload()}
          />
        )}
      </View>
    );
  }
  const data = detail.data;
  const book = data.lorebook;
  const stats = bookStats(data.book);
  const lines = reportLines(book.report);

  const more = async (): Promise<void> => {
    const key = await overlay.menu({ title: book.name, items: actions.menuItems() });
    if (key === "rename") {
      const next = await actions.rename(book);
      if (next) detail.setData(() => next);
    }
    if (key === "delete" && (await actions.remove({ ...book, scenario_count: data.scenarios.length }))) {
      router.back();
    }
  };

  const saveDescription = async (): Promise<void> => {
    const text = description.trim();
    if (text === book.description) return;
    try {
      const next = await api.lorebooks.update(book.id, { description: text });
      detail.setData(() => next);
    } catch (e) {
      void detail.reload();
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const errorFor = (field: string): string | null => {
    const issue = issues.find((i) => i.field === field && i.level === "error");
    if (issue) return issueProblem(issue);
    return form.serverField === field && form.status.kind === "failed" ? form.status.error : null;
  };
  const bookError = issues.find((i) => i.field === "book");

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Page
        header={
          <NavBar
            title={book.name}
            actions={[{ icon: "more", label: t("common.more"), onPress: () => void more() }]}
          />
        }
        contentStyle={styles.content}
      >
        <Text style={[styles.caption, { color: c.mut }]}>
          {[t(`lorebook.source.${book.source}`), formatRelative(book.updated_at)].join(" · ")}
        </Text>
        <View style={styles.stats}>
          {[
            { n: stats.entries, label: t("lorebook.statEntries") },
            { n: stats.constant, label: t("lorebook.statConstant") },
            { n: stats.disabled, label: t("lorebook.statDisabled") },
          ].map((stat) => (
            <View
              key={stat.label}
              accessible
              accessibilityLabel={`${stat.label} ${stat.n}`}
              style={[styles.stat, { borderColor: c.ink, backgroundColor: c.paper }]}
            >
              <Text style={[styles.statNumber, { color: c.ink }]}>{stat.n}</Text>
              <Text numberOfLines={1} style={[styles.statLabel, { color: c.mut }]}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>
        <Field
          label={t("lorebook.description")}
          optional
          multiline
          boxHeight={88}
          value={description}
          maxLength={LOREBOOK_LIMITS.description}
          placeholder={t("lorebook.descriptionPlaceholder")}
          onChangeText={setDescription}
          onBlur={() => void saveDescription()}
        />
        {lines.length ? (
          <Notice
            tone="warn"
            message={[t("lorebook.reportTitle"), ...lines.map((line) => `· ${line}`)].join("\n")}
          />
        ) : null}

        <SectionHeader title={t("lorebook.usedByTitle")} style={styles.section} />
        {data.scenarios.length ? (
          <Group>
            {data.scenarios.map((s) => (
              <ListRow
                key={s.id}
                title={s.name}
                chevron
                onPress={() => router.push({ pathname: "/scenario/[id]", params: { id: s.id } })}
              />
            ))}
          </Group>
        ) : (
          <Text style={[styles.caption, { color: c.mut }]}>{t("lorebook.notUsed")}</Text>
        )}
        <Text style={[styles.caption, { color: c.mut }]}>{t("lorebook.note")}</Text>

        <View style={styles.entriesHead}>
          <Text style={[styles.entriesTitle, { color: c.ink }]}>{t("lorebook.entriesTitle")}</Text>
          <Text
            numberOfLines={1}
            style={[
              styles.caption,
              { flex: 1, textAlign: "right", color: form.status.kind === "failed" ? c.err : c.mut },
            ]}
          >
            {statusText(form.status)}
          </Text>
        </View>
        <Field
          label={t("lorebook.searchEntries")}
          hideLabel
          value={search}
          placeholder={t("lorebook.searchEntries")}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {bookError ? <Notice message={issueProblem(bookError)} /> : null}
        {form.book ? (
          <BookEditor book={form.book} onChange={form.update} errorFor={errorFor} filter={search} />
        ) : (
          <Loading />
        )}

        <Button
          label={t("lorebook.delete")}
          variant="danger"
          icon="trash"
          onPress={() =>
            void actions.remove({ ...book, scenario_count: data.scenarios.length }).then((gone) => {
              if (gone) router.back();
            })
          }
          style={{ marginTop: space.xl }}
        />
      </Page>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.page, paddingTop: space.m, gap: space.m },
  caption: { fontSize: 13, lineHeight: 19 },
  stats: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: space.m,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  statNumber: { fontFamily: font.monoMedium, fontSize: 20, lineHeight: 26, fontWeight: "700" },
  statLabel: { fontSize: 12.5, lineHeight: 17 },
  section: { paddingHorizontal: 0, paddingBottom: 0, paddingTop: space.l },
  entriesHead: { flexDirection: "row", alignItems: "baseline", gap: space.m, paddingTop: space.l },
  entriesTitle: { fontSize: 22, lineHeight: 28, fontWeight: "900" },
});
