/**
 * 工作台首页（同网页端 pages/workbench/WorkbenchHome.tsx）：一句话开始（输入框和示例），导入角色卡，手动新建；
 * 下面是没保存的草稿（写明在等什么，长按可以删除）和最近保存的角色卡。
 * 发出去就新建一份草稿并开 agent 的第一轮，进草稿页。
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { DraftSummary } from "@bettertavern/core/api/types";
import { formatRelative } from "@bettertavern/core/utils/format";
import { cardOrigin } from "@bettertavern/core/workbench/labels";
import { draftStatus } from "@bettertavern/core/workbench/progress";

import { Portrait } from "../../src/components/Portrait.tsx";
import {
  Chip,
  Group,
  GroupLabel,
  Icon,
  LargeHeader,
  ListRow,
  Notice,
  Page,
  press,
  useOverlay,
  useTabBarSpace,
  type IconName,
} from "../../src/components/ui.tsx";
import { useCardImport } from "../../src/features/workbench/useCardImport.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import {
  comicDepth,
  comicRadius,
  comicStroke,
  font,
  space,
  useComic,
} from "../../src/theme/index.ts";

/** 导入、手动新建：白底墨线的格子，左上一个灰底墨线的图标方块 */
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
  const c = useComic();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.entry,
        { borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper, opacity: busy ? 0.6 : 1 },
      ]}
    >
      <View style={[styles.entryIcon, { borderColor: c.ink, backgroundColor: c.grey }]}>
        <Icon name={icon} size={18} color={c.ink} />
      </View>
      <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: "900", color: c.ink }}>{title}</Text>
      <Text style={{ fontSize: 13, lineHeight: 20, color: c.mut }}>{note}</Text>
    </Pressable>
  );
}

/** 草稿、角色卡一行下面的小字：agent 在忙时是蓝色，前面一个蓝点 */
function RowStatus({ text, time, busy }: { text: string; time: string; busy: boolean }) {
  const c = useComic();
  return (
    <View style={styles.status}>
      {busy ? <View style={[styles.dot, { backgroundColor: c.acc }]} /> : null}
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 12.5, fontWeight: busy ? "700" : "400", color: busy ? c.acc : c.mut }}
      >
        {text}
      </Text>
      <Text style={{ fontSize: 12.5, color: c.mut }}>· {time}</Text>
    </View>
  );
}

export default function WorkbenchScreen() {
  const { api } = useApp();
  const router = useRouter();
  const overlay = useOverlay();
  const c = useComic();
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
      {importer.problem ? (
        <Notice title={importer.problem.title} message={importer.problem.message} onClose={importer.dismiss} />
      ) : null}
      {problem ? <Notice message={problem} onClose={() => setProblem(null)} /> : null}
      <View style={[styles.composer, { borderColor: c.ink, backgroundColor: c.paper }]}>
        <TextInput
          accessibilityLabel={t("workbench.home.prompt")}
          placeholder={t("workbench.home.composerPlaceholder")}
          placeholderTextColor={c.mut}
          value={text}
          multiline
          maxLength={8000}
          onChangeText={setText}
          style={[styles.input, { color: c.ink }]}
        />
        <View style={styles.composerBar}>
          <View style={[styles.tip, { borderColor: c.ink }]}>
            <Icon name="workbench" size={14} color={c.ink} />
            <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "600", color: c.ink }}>
              {t("workbench.home.agentTip")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workbench.home.send")}
            accessibilityState={{ disabled: !text.trim() || starting }}
            disabled={!text.trim() || starting}
            onPress={() => void start()}
            style={({ pressed }) => [
              styles.send,
              text.trim() && !starting
                ? [{ backgroundColor: c.ink, borderColor: c.ink }, press(pressed, comicDepth.iconButton, c.acc)]
                : { backgroundColor: c.disabled, borderColor: c.disabled },
            ]}
          >
            <Icon name="send" size={18} color={c.paper} />
          </Pressable>
        </View>
      </View>
      <GroupLabel style={styles.label}>{t("workbench.home.examplesLabel")}</GroupLabel>
      <View style={styles.examples} accessibilityLabel={t("workbench.home.examplesLabel")}>
        {t("workbench.home.examples")
          .split("|")
          .map((example) => (
            <Chip key={example} label={example} onPress={() => setText(example)} />
          ))}
      </View>
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
          <View style={styles.labelRow}>
            <GroupLabel style={styles.labelInRow}>{t("workbench.home.drafts")}</GroupLabel>
            <Text style={{ fontFamily: font.monoMedium, fontSize: 13, color: c.mut }}>{draftList.length}</Text>
          </View>
          <Group>
            {draftList.map((draft) => {
              const names = [draft.name, draft.character_name].filter(
                (n, i, all): n is string => !!n && all.indexOf(n) === i,
              );
              const title = names.join(" · ") || t("workbench.home.untitled");
              return (
                <ListRow
                  key={draft.id}
                  title={title}
                  leading={
                    <Portrait
                      name={draft.character_name || draft.name || title}
                      seed={draft.id}
                      blobId={draft.cover_blob_id}
                      size={40}
                    />
                  }
                  detail={
                    <RowStatus
                      text={draftStatus(draft)}
                      time={formatRelative(draft.updated_at)}
                      busy={draft.agent_status !== "idle"}
                    />
                  }
                  onPress={() => openDraft(draft.id)}
                  onLongPress={() => void remove(draft)}
                />
              );
            })}
          </Group>
        </>
      ) : null}

      {recent.length ? (
        <>
          <View style={styles.labelRow}>
            <GroupLabel style={styles.labelInRow}>{t("workbench.home.recent")}</GroupLabel>
            <Text
              accessibilityRole="link"
              onPress={() => router.push({ pathname: "/library", params: { tab: "cards" } })}
              style={{ fontSize: 14, fontWeight: "700", color: c.acc }}
            >
              {t("workbench.home.allCards")}
            </Text>
          </View>
          <Group>
            {recent.map((card) => (
              <ListRow
                key={card.id}
                title={card.name}
                subtitle={`${cardOrigin(card)} · ${formatRelative(card.updated_at)}`}
                leading={<Portrait name={card.name} seed={card.id} blobId={card.cover_blob_id} size={40} />}
                onPress={() => router.push({ pathname: "/card/[id]", params: { id: card.id } })}
              />
            ))}
          </Group>
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
  content: { paddingHorizontal: 20, gap: 14 },
  composer: {
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    padding: 14,
    gap: 10,
  },
  input: { minHeight: 72, maxHeight: 160, fontSize: 16, lineHeight: 25, textAlignVertical: "top" },
  composerBar: { flexDirection: "row", alignItems: "center", gap: space.s },
  tip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderWidth: comicStroke.chip,
    borderRadius: 8,
    marginRight: "auto",
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { paddingHorizontal: 4, paddingTop: space.xs, paddingBottom: 0 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: space.s,
    paddingRight: 4,
  },
  labelInRow: { paddingHorizontal: 4, paddingTop: 0, paddingBottom: 0 },
  examples: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  entries: { flexDirection: "row", gap: 14 },
  entry: {
    flex: 1,
    padding: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    gap: 4,
  },
  entryIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  status: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
