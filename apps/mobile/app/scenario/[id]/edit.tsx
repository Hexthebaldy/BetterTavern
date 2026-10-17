/**
 * 编辑角色卡：剧本名、角色名、标签；描述、性格；情境、开场白；对话示例；卡片自带的世界书（BookEditor.tsx）。
 * - 顶上说明：修改只影响之后开始的新故事；{{user}} 会换成主角的名字，{{char}} 会换成角色名。
 * - 保存前先按和服务端相同的规则检查（@bettertavern/core/scenario/cardEdit），不合格的字段标红；之后每次修改都重新检查，
 *   改好的字段马上恢复。
 * - 保存带版本号：别处改过（409 CARD_CHANGED）时提示重新加载；保存成功回到剧本详情。
 * - 有没保存的修改时离开，先问“放弃修改？”。页底“恢复导入时的内容”，要确认。
 * 平板上内容收进居中的一栏（最宽 640）。
 */

import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { ScenarioCard } from "@bettertavern/core/api/types";
import {
  CARD_LIMITS,
  charCount,
  checkDraft,
  describeField,
  draftFrom,
  fieldLabel,
  isDirty,
  toInput,
  type CardDraft,
  type DraftProblem,
  type TextField,
} from "@bettertavern/core/scenario/cardEdit";

import {
  Button,
  ErrorState,
  Field,
  Loading,
  NavBar,
  Notice,
  SectionHeader,
  useColumnStyle,
  useOverlay,
} from "../../../src/components/ui.tsx";
import { BookEditor } from "../../../src/features/scenario/BookEditor.tsx";
import { useApp } from "../../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../../src/theme/index.ts";

/** 字数到上限的八成时开始显示 */
function lengthHint(text: string, limit: number): string | undefined {
  const n = charCount(text);
  return n >= limit * 0.8 ? `${n} / ${limit}` : undefined;
}

export default function EditCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const navigation = useNavigation();
  const overlay = useOverlay();
  const palette = usePalette();
  const column = useColumnStyle();
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ScenarioCard | null>(null);
  const [original, setOriginal] = useState<CardDraft | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  // 保存时本地检查没通过之后，每次修改都重新检查，改好的字段马上不再标红
  const [recheck, setRecheck] = useState(false);
  const [saving, setSaving] = useState(false);
  // 保存成功、确认放弃之后要离开：这时不再拦
  const leaving = useRef(false);

  const apply = useCallback((next: ScenarioCard) => {
    const fresh = draftFrom(next);
    setDetail(next);
    setOriginal(fresh);
    setDraft(fresh);
    setProblems([]);
    setRecheck(false);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      apply(await api.scenarios.card(id));
    } catch (e) {
      setLoadError(e);
    }
  }, [api, id, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = !!original && !!draft && isDirty(original, draft);
  const shown = useMemo(() => (recheck && draft ? checkDraft(draft) : problems), [recheck, draft, problems]);

  usePreventRemove(dirty, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
      return;
    }
    void overlay
      .confirm({
        title: t("cardEdit.discardTitle"),
        message: t("cardEdit.discardMessage"),
        confirmLabel: t("cardEdit.discard"),
        cancelLabel: t("cardEdit.keepEditing"),
        tone: "danger",
      })
      .then((ok) => {
        if (!ok) return;
        leaving.current = true;
        navigation.dispatch(data.action);
      });
  });

  if (!draft || !detail) {
    if (loadError) {
      return (
        <View style={{ flex: 1, backgroundColor: palette.bg }}>
          <NavBar title={t("scenario.editCard")} />
          <ErrorState
            title={t("cardEdit.loadFailed")}
            message={describeError(loadError)}
            onRetry={() => void load()}
          />
        </View>
      );
    }
    return <Loading />;
  }

  const errorFor = (field: string): string | null => shown.find((p) => p.field === field)?.message ?? null;
  const set = (patch: Partial<CardDraft>): void => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async (): Promise<void> => {
    const local = checkDraft(draft);
    setProblems(local);
    setRecheck(local.length > 0);
    if (local.length > 0) {
      overlay.toast(
        t("cardEdit.needsFixing", { count: local.length, field: describeField(local[0]?.field ?? "") }),
        {
          icon: "alert",
        },
      );
      return;
    }
    setSaving(true);
    let saved: ScenarioCard;
    try {
      saved = await api.scenarios.saveCard(id, toInput(draft, detail.version));
    } catch (e) {
      // 先停下转圈，再弹窗问
      setSaving(false);
      if (e instanceof ApiError && e.code === "CARD_CHANGED") {
        const reload = await overlay.confirm({
          title: t("cardEdit.conflictTitle"),
          message: t("cardEdit.conflictMessage"),
          confirmLabel: t("common.reload"),
        });
        if (reload) await load();
      } else if (e instanceof ApiError && typeof e.field("field") === "string") {
        const field = e.field("field") as string;
        const problem = describeError(e);
        setProblems([{ field, message: problem }]);
        overlay.toast(t("cardEdit.fieldProblem", { field: describeField(field), problem }), {
          icon: "alert",
        });
      } else {
        overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
      }
      return;
    }
    setSaving(false);
    apply(saved);
    overlay.toast(t("cardEdit.saved"));
    leaving.current = true;
    router.back();
  };

  const reset = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("cardEdit.resetTitle"),
      message: t("cardEdit.resetMessage"),
      confirmLabel: t("cardEdit.resetConfirm"),
      tone: "danger",
      icon: "retry",
    });
    if (!ok) return;
    try {
      apply(await api.scenarios.resetCard(id));
      overlay.toast(t("cardEdit.resetDone"));
    } catch (e) {
      overlay.toast(t("cardEdit.resetFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const textField = (field: TextField, boxHeight: number, hint?: string) => (
    <Field
      label={fieldLabel(field)}
      optional
      multiline
      boxHeight={boxHeight}
      value={draft[field]}
      onChangeText={(value) => set({ [field]: value } as Partial<CardDraft>)}
      hint={lengthHint(draft[field], CARD_LIMITS.field) ?? hint}
      error={errorFor(field)}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <NavBar
        title={t("scenario.editCard")}
        actions={[{ icon: "check", label: t("common.save"), onPress: () => void save() }]}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, column]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Notice tone="info" message={t("cardEdit.notice", { user: "{{user}}", char: "{{char}}" })} />
          {errorFor("card") ? <Notice tone="error" message={errorFor("card") ?? ""} /> : null}

          <SectionHeader title={t("cardEdit.sections.basic")} style={styles.section} />
          <Field
            label={fieldLabel("display_name")}
            value={draft.displayName}
            onChangeText={(displayName) => set({ displayName })}
            hint={t("cardEdit.hints.displayName")}
            error={errorFor("display_name")}
          />
          <Field
            label={fieldLabel("name")}
            value={draft.name}
            onChangeText={(name) => set({ name })}
            hint={t("cardEdit.hints.name", { char: "{{char}}" })}
            error={errorFor("name")}
          />
          <Field
            label={fieldLabel("tags")}
            optional
            value={draft.tags}
            onChangeText={(tags) => set({ tags })}
            hint={t("cardEdit.hints.list")}
            error={errorFor("tags")}
          />

          <SectionHeader title={t("cardEdit.sections.character")} style={styles.section} />
          {textField("description", 180, t("cardEdit.hints.description"))}
          {textField("personality", 110)}

          <SectionHeader title={t("cardEdit.sections.opening")} style={styles.section} />
          {textField("scenario", 120, t("cardEdit.hints.scenario"))}
          {textField("first_mes", 150, t("cardEdit.hints.first_mes"))}

          <SectionHeader title={t("cardEdit.sections.speech")} style={styles.section} />
          {textField("mes_example", 150, t("cardEdit.hints.mes_example"))}

          <SectionHeader
            title={t("cardEdit.book")}
            meta={t("cardEdit.entries", { count: draft.book.length })}
            style={styles.section}
          />
          <Text style={[styles.note, { color: palette.mut }]}>{t("cardEdit.bookNote")}</Text>
          {errorFor("book") ? <Notice tone="error" message={errorFor("book") ?? ""} /> : null}
          <BookEditor book={draft.book} onChange={(book) => set({ book })} errorFor={errorFor} />

          <Button
            label={t("cardEdit.saveChanges")}
            onPress={() => void save()}
            busy={saving}
            disabled={!dirty}
            style={styles.save}
          />
          <Button label={t("cardEdit.reset")} variant="text" onPress={() => void reset()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.page, paddingTop: space.s, paddingBottom: 56, gap: space.m },
  /** 内容已经有左右边距，小标题不再缩进 */
  section: { paddingHorizontal: 0, paddingBottom: 0 },
  note: { fontSize: 13, lineHeight: 20, marginTop: -space.s },
  save: { marginTop: space.l },
});
