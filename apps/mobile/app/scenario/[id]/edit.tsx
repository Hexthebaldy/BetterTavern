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
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { ScenarioCard } from "@bettertavern/core/api/types";
import {
  CARD_LIMITS,
  charCount,
  checkDraft,
  describeField,
  draftFrom,
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
        title: "放弃修改？",
        message: "这里改的内容还没有保存。",
        confirmLabel: "放弃",
        cancelLabel: "继续编辑",
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
          <NavBar title="编辑角色卡" />
          <ErrorState
            title="角色卡没加载出来"
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
      overlay.toast(`有 ${local.length} 处需要修改：${describeField(local[0]?.field ?? "")}`, {
        icon: "alert",
      });
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
          title: "这张角色卡在别处改过了",
          message: "重新加载会丢掉这里还没保存的修改。",
          confirmLabel: "重新加载",
        });
        if (reload) await load();
      } else if (e instanceof ApiError && typeof e.field("field") === "string") {
        const field = e.field("field") as string;
        setProblems([{ field, message: e.message }]);
        overlay.toast(`${describeField(field)}：${e.message}`, { icon: "alert" });
      } else {
        overlay.toast(`保存失败：${describeError(e)}`, { icon: "alert" });
      }
      return;
    }
    setSaving(false);
    apply(saved);
    overlay.toast("已保存，之后开始的新故事会用改过的角色卡");
    leaving.current = true;
    router.back();
  };

  const reset = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "恢复导入时的内容？",
      message: "角色卡（包括世界书）会回到刚导入时的样子，剧本名不变。改过的内容找不回来。",
      confirmLabel: "恢复",
      tone: "danger",
      icon: "retry",
    });
    if (!ok) return;
    try {
      apply(await api.scenarios.resetCard(id));
      overlay.toast("已恢复成导入时的内容");
    } catch (e) {
      overlay.toast(`恢复失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const textField = (field: TextField, label: string, boxHeight: number, hint?: string) => (
    <Field
      label={label}
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
      <NavBar title="编辑角色卡" actions={[{ icon: "check", label: "保存", onPress: () => void save() }]} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, column]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Notice
            tone="info"
            message="修改只影响之后开始的新故事，已经开始的故事不变。文中的 {{user}} 会换成主角的名字，{{char}} 会换成角色名。"
          />
          {errorFor("card") ? <Notice tone="error" message={errorFor("card") ?? ""} /> : null}

          <SectionHeader title="基本" style={styles.section} />
          <Field
            label="剧本名"
            value={draft.displayName}
            onChangeText={(displayName) => set({ displayName })}
            hint="只在剧本库里显示"
            error={errorFor("display_name")}
          />
          <Field
            label="角色名"
            value={draft.name}
            onChangeText={(name) => set({ name })}
            hint="故事里这个角色的名字，替换 {{char}}"
            error={errorFor("name")}
          />
          <Field
            label="标签"
            optional
            value={draft.tags}
            onChangeText={(tags) => set({ tags })}
            hint="用逗号或顿号分开"
            error={errorFor("tags")}
          />

          <SectionHeader title="角色" style={styles.section} />
          {textField("description", "描述", 180, "外貌、身份、经历")}
          {textField("personality", "性格", 110)}

          <SectionHeader title="场景与开场" style={styles.section} />
          {textField("scenario", "情境", 120, "故事开始时的处境")}
          {textField("first_mes", "开场白", 150, "只参考情境和语气，开场由导演重新写")}

          <SectionHeader title="说话方式" style={styles.section} />
          {textField("mes_example", "对话示例", 150, "用来提炼角色的说话方式")}

          <SectionHeader title="世界书" meta={`${draft.book.length} 条`} style={styles.section} />
          <Text style={[styles.note, { color: palette.mut }]}>
            开局搭建世界时，常驻条目优先，其次按这里的顺序，最多用 40 条；不启用的条目不用。
          </Text>
          {errorFor("book") ? <Notice tone="error" message={errorFor("book") ?? ""} /> : null}
          <BookEditor book={draft.book} onChange={(book) => set({ book })} errorFor={errorFor} />

          <Button
            label="保存修改"
            onPress={() => void save()}
            busy={saving}
            disabled={!dirty}
            style={styles.save}
          />
          <Button label="恢复导入时的内容" variant="text" onPress={() => void reset()} />
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
