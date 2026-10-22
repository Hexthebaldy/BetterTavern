/**
 * 工作台首页（同网页端 pages/workbench/WorkbenchHome.tsx）：一句话开始（输入框和示例），导入角色卡，手动新建；
 * 下面是没保存的草稿（写明在等什么，长按可以删除）和最近保存的角色卡。
 * 发出去就新建一份草稿并开 agent 的第一轮，进草稿页。
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { DraftSummary } from "@bettertavern/core/api/types";
import { formatRelative } from "@bettertavern/core/utils/format";
import { cardOrigin } from "@bettertavern/core/workbench/labels";
import { draftStatus } from "@bettertavern/core/workbench/progress";

import { Cover } from "../../src/components/Cover.tsx";
import {
  Icon,
  IconButton,
  LargeHeader,
  Notice,
  Page,
  SectionHeader,
  useOverlay,
  useTabBarSpace,
  type IconName,
} from "../../src/components/ui.tsx";
import { useCardImport } from "../../src/features/workbench/useCardImport.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { radius, space, usePalette } from "../../src/theme/index.ts";

function Entry({
  icon,
  title,
  note,
  busy,
  onPress,
}: {
  icon: IconName;
  title: string;
  note: string;
  busy?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.entry,
        { backgroundColor: pressed ? palette.bg3 : palette.bg2, opacity: busy ? 0.6 : 1 },
      ]}
    >
      <View style={[styles.entryIcon, { backgroundColor: palette.card }]}>
        <Icon name={icon} size={20} color={palette.ink} />
      </View>
      <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>{title}</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, color: palette.mut }}>{note}</Text>
    </Pressable>
  );
}

export default function WorkbenchScreen() {
  const { api } = useApp();
  const router = useRouter();
  const overlay = useOverlay();
  const palette = usePalette();
  const { t, i18n } = useTranslation();
  const { bottom } = useTabBarSpace();
  const drafts = useAsync(() => api.workbench.list(), [api]);
  const cards = useAsync(() => api.cards.list(), [api]);
  const importer = useCardImport();
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const openDraft = (id: string): void => router.push({ pathname: "/workbench/[id]", params: { id } });

  const start = async (): Promise<void> => {
    const value = text.trim();
    if (!value || starting) return;
    setStarting(true);
    setProblem(null);
    try {
      const draft = await api.workbench.startAgent(value, i18n.language);
      setText("");
      openDraft(draft.draft.id);
    } catch (e) {
      setProblem(describeError(e));
    } finally {
      setStarting(false);
    }
  };

  const manual = async (): Promise<void> => {
    setCreating(true);
    try {
      const draft = await api.workbench.createManual(i18n.language);
      openDraft(draft.draft.id);
    } catch (e) {
      setProblem(describeError(e));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (draft: DraftSummary): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("workbench.home.deleteDraftConfirm"),
      message: t("workbench.home.deleteDraftMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.workbench.remove(draft.id);
      drafts.setData((list) => list?.filter((d) => d.id !== draft.id));
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const draftList = drafts.data ?? [];
  const recent = (cards.data ?? []).slice(0, 3);
  return (
    <Page
      header={<LargeHeader title={t("workbench.title")} />}
      bottomSpace={bottom}
      refreshing={drafts.refreshing}
      onRefresh={() => {
        void drafts.refresh();
        void cards.reload();
      }}
      contentStyle={styles.content}
    >
      <Text style={[styles.prompt, { color: palette.ink }]}>{t("workbench.home.prompt")}</Text>
      {importer.problem ? (
        <Notice title={importer.problem.title} message={importer.problem.message} onClose={importer.dismiss} />
      ) : null}
      {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}
      <View style={[styles.composer, { backgroundColor: palette.bg2 }]}>
        <TextInput
          accessibilityLabel={t("workbench.home.prompt")}
          placeholder={t("workbench.home.placeholder")}
          placeholderTextColor={palette.mut}
          value={text}
          multiline
          maxLength={8000}
          onChangeText={setText}
          style={[styles.input, { color: palette.ink }]}
        />
        <View style={{ alignItems: "flex-end" }}>
          <IconButton
            icon="send"
            label={t("workbench.home.send")}
            tone="plain"
            color={palette.bg}
            diameter={36}
            size={18}
            disabled={!text.trim() || starting}
            onPress={() => void start()}
            style={{ backgroundColor: palette.ink }}
          />
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6 }}
        accessibilityLabel={t("workbench.home.examplesLabel")}
      >
        {t("workbench.home.examples")
          .split("|")
          .map((example) => (
            <Text
              key={example}
              accessibilityRole="button"
              onPress={() => setText(example)}
              numberOfLines={1}
              style={[styles.example, { borderColor: palette.line, color: palette.ink2 }]}
            >
              {example}
            </Text>
          ))}
      </ScrollView>
      <View style={styles.entries}>
        <Entry
          icon="import"
          title={importer.importing ? t("workbench.import.importing", { name: importer.importing }) : t("workbench.home.import")}
          note={t("workbench.home.importNote")}
          busy={importer.importing !== null}
          onPress={() => void importer.pick()}
        />
        <Entry
          icon="write"
          title={t("workbench.home.manual")}
          note={t("workbench.home.manualNote")}
          busy={creating}
          onPress={() => void manual()}
        />
      </View>

      {draftList.length ? (
        <>
          <SectionHeader title={t("workbench.home.drafts")} style={styles.section} />
          {draftList.map((draft) => (
            <Pressable
              key={draft.id}
              accessibilityRole="button"
              accessibilityHint={t("workbench.home.deleteDraft")}
              onPress={() => openDraft(draft.id)}
              onLongPress={() => void remove(draft)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.bg3 : palette.bg2 }]}
            >
              <Cover seed={draft.id} blobId={draft.cover_blob_id} width={44} height={44} surface="card" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.ink }]}>
                  {draft.name || draft.character_name || t("workbench.home.untitled")}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 12.5, color: draft.agent_status !== "idle" ? palette.acc : palette.mut }}
                >
                  {draftStatus(draft)} · {formatRelative(draft.updated_at)}
                </Text>
              </View>
              <Icon name="chevronRight" size={18} color={palette.mut} />
            </Pressable>
          ))}
        </>
      ) : null}

      {recent.length ? (
        <>
          <SectionHeader
            title={t("workbench.home.recent")}
            meta={
              <Text
                accessibilityRole="link"
                onPress={() => router.push({ pathname: "/library", params: { tab: "cards" } })}
                style={{ fontSize: 13, color: palette.acc }}
              >
                {t("workbench.home.allCards")}
              </Text>
            }
            style={styles.section}
          />
          {recent.map((card) => (
            <Pressable
              key={card.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/card/[id]", params: { id: card.id } })}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.bg3 : palette.bg2 }]}
            >
              <Cover seed={card.id} blobId={card.cover_blob_id} width={44} height={44} surface="card" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.ink }]}>
                  {card.name}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.mut }}>
                  {cardOrigin(card)} · {formatRelative(card.updated_at)}
                </Text>
              </View>
              <Icon name="chevronRight" size={18} color={palette.mut} />
            </Pressable>
          ))}
        </>
      ) : null}
      {drafts.error && !drafts.data ? (
        <Notice
          icon="offline"
          message={t("workbench.home.loadFailed")}
          actionLabel={t("common.retry")}
          onAction={() => void drafts.reload()}
        />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.l, gap: space.m },
  prompt: { fontSize: 22, lineHeight: 30, fontWeight: "700", paddingTop: space.s },
  composer: { borderRadius: radius.sheet, padding: 14, gap: space.s },
  input: { minHeight: 72, maxHeight: 160, fontSize: 15, lineHeight: 24, textAlignVertical: "top" },
  example: {
    maxWidth: 280,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    fontSize: 13,
  },
  entries: { flexDirection: "row", gap: space.m },
  entry: { flex: 1, padding: 16, borderRadius: radius.card, gap: 6 },
  entryIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  section: { paddingHorizontal: 0, paddingBottom: 0, paddingTop: space.l },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, padding: 10, borderRadius: radius.option },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
});
