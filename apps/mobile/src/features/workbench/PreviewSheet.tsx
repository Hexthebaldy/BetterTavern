/**
 * 卡片预览（同网页端 pages/workbench/PreviewPane.tsx 和手动模式的检查栏），从页头的“预览”打开的整屏面板：
 * - Agent 模式三个标签：卡片（正在写的字段蓝底实时出字，待采用的改动绿框）、资料（每条用在哪里）、图片（点一下当封面）；
 * - 手动模式：检查（问题清单，点一下回到那一节）、字数、开场在阅读页里的样子。
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { Hunk, Issue } from "@bettertavern/core/api/types";
import {
  charCount,
  describeIssue,
  fieldLabel,
  TEXT_FIELDS,
  type CardDraft,
  type TextField,
} from "@bettertavern/core/scenario/cardEdit";
import { fieldList } from "@bettertavern/core/workbench/labels";
import { awaitedMessage, type WorkbenchState } from "@bettertavern/core/workbench/session";

import { Icon, Pill, Segmented, Sheet } from "../../components/ui.tsx";
import { font, space, usePalette } from "../../theme/index.ts";
import { AssetTile, BlobImage, type CoverActions } from "./assets.tsx";

type Tab = "card" | "notes" | "images";

function pendingFields(state: WorkbenchState): { fields: Map<string, string>; others: number } {
  const awaited = awaitedMessage(state);
  const fields = new Map<string, string>();
  let others = 0;
  if (awaited?.kind === "changes") {
    for (const hunk of awaited.content.hunks as Hunk[]) {
      if (hunk.state !== "pending") continue;
      if ("field" in hunk.target && hunk.after !== null) fields.set(hunk.target.field, hunk.after);
      else others += 1;
    }
  }
  return { fields, others };
}

export function IssueList({ issues, onPick }: { issues: readonly Issue[]; onPick?: (issue: Issue) => void }) {
  const palette = usePalette();
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return (
    <View style={{ gap: 6 }}>
      {sorted.map((issue, i) => {
        const color = issue.level === "error" ? palette.err : palette.warn;
        return (
          <Pressable
            key={`${issue.field}:${issue.code}:${i}`}
            disabled={!onPick}
            onPress={() => onPick?.(issue)}
            style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}
          >
            <Icon name={issue.level === "error" ? "alertCircle" : "info"} size={14} color={color} />
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color }}>{describeIssue(issue)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Block({
  label,
  meta,
  text,
  tone,
}: {
  label: string;
  meta?: string;
  text: string;
  tone?: "writing" | "change";
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const accent = tone === "writing" ? palette.acc : tone === "change" ? palette.ok : palette.mut;
  return (
    <View
      style={[
        styles.block,
        {
          backgroundColor: tone === "writing" ? palette.accBg : palette.card,
          borderColor: tone === "change" ? palette.ok : "transparent",
        },
      ]}
    >
      <View style={styles.blockHead}>
        <Text style={{ fontSize: 11.5, color: accent }}>{label}</Text>
        {meta ? <Text style={{ fontSize: 11.5, color: accent }}>{meta}</Text> : null}
      </View>
      {text.trim() || tone === "writing" ? (
        <Text style={{ fontSize: 14, lineHeight: 22, color: palette.ink }} numberOfLines={tone ? undefined : 8}>
          {text}
        </Text>
      ) : (
        <Text style={{ fontSize: 13, color: palette.mut }}>{t("workbench.preview.empty")}</Text>
      )}
    </View>
  );
}

function CardBody({ state, onOpenCover }: { state: WorkbenchState; onOpenCover: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const { card, draft } = state.draft;
  const pending = pendingFields(state);
  const writing = state.writing;
  const writingLore = writing?.target.startsWith("lore:") ? writing.target.slice(5) : null;
  const field = (f: TextField) => {
    const live = writing?.target === `field:${f}` ? writing.text : null;
    const changed = pending.fields.get(f);
    const text = live ?? changed ?? card[f];
    if (!text.trim() && live === null && (f === "system_prompt" || f === "creator_notes")) return null;
    return (
      <Block
        key={f}
        label={fieldLabel(f)}
        meta={
          live !== null
            ? t("workbench.preview.writing")
            : changed !== undefined
              ? t("workbench.status.changes")
              : text
                ? t("workbench.preview.chars", { n: charCount(text) })
                : undefined
        }
        text={text}
        tone={live !== null ? "writing" : changed !== undefined ? "change" : undefined}
      />
    );
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workbench.cover.change")}
        onPress={onOpenCover}
        style={[styles.cover, { backgroundColor: palette.card, borderColor: palette.line2 }]}
      >
        {draft.cover_blob_id ? (
          <BlobImage blobId={draft.cover_blob_id} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Icon name="image" size={16} color={palette.mut} />
            <Text style={{ color: palette.mut, fontSize: 13 }}>{t("workbench.cover.title")}</Text>
          </View>
        )}
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ fontSize: 24, fontWeight: "800", color: palette.ink }}>
          {(writing?.target === "field:name" ? writing.text : card.name) || t("workbench.home.untitled")}
        </Text>
        {draft.name && draft.name !== card.name ? (
          <Text style={{ fontSize: 12.5, color: palette.mut }}>{draft.name}</Text>
        ) : null}
      </View>
      {card.tags.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {card.tags.map((tag) => (
            <Pill key={tag} label={tag} tone="card" />
          ))}
        </View>
      ) : null}
      {TEXT_FIELDS.map(field)}
      {card.alternate_greetings.length ? (
        <Block
          label={t("workbench.preview.greetings", { count: card.alternate_greetings.length })}
          text={card.alternate_greetings.map((g, i) => `${i + 1}. ${g}`).join("\n\n")}
        />
      ) : null}
      <Block
        label={t("workbench.preview.entries", { count: card.book.length })}
        meta={
          writingLore !== null
            ? t("workbench.preview.writing")
            : pending.others
              ? t("workbench.status.changes")
              : undefined
        }
        tone={writingLore !== null ? "writing" : undefined}
        text={[
          ...card.book.map((e) => `${e.name || e.keys[0] || "—"}　${e.content.slice(0, 60)}`),
          ...(writingLore !== null && writing ? [`${writingLore}　${writing.text.slice(-120)}`] : []),
        ].join("\n")}
      />
      {state.draft.issues.length ? <IssueList issues={state.draft.issues} /> : null}
    </>
  );
}

function NotesBody({ state }: { state: WorkbenchState }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const notes = state.draft.notes;
  if (!notes.length) return <Text style={styles.empty}>{t("workbench.preview.noNotes")}</Text>;
  return (
    <>
      {notes.map((note) => (
        <View key={note.id} style={[styles.block, { backgroundColor: palette.card, gap: 6 }]}>
          <Text
            accessibilityRole="link"
            numberOfLines={1}
            onPress={() => void Linking.openURL(note.url)}
            style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}
          >
            {note.title || note.url}
          </Text>
          <Text style={{ fontFamily: font.mono, fontSize: 11, color: palette.mut }}>{note.site}</Text>
          <Text style={{ fontSize: 13, lineHeight: 20, color: palette.ink2 }}>{note.text}</Text>
          {note.used_in.length ? (
            <Pill label={t("workbench.preview.usedIn", { fields: fieldList(note.used_in) })} tone="acc" />
          ) : null}
        </View>
      ))}
    </>
  );
}

/** 手动模式：检查、字数、开场在阅读页里的样子 */
export function CheckBody({ card, issues, onPick }: { card: CardDraft; issues: Issue[]; onPick: (issue: Issue) => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const lengths = TEXT_FIELDS.filter((f) => card[f].trim())
    .map((f) => `${fieldLabel(f)} ${charCount(card[f].trim())}`)
    .join(" · ");
  const name = card.name.trim();
  const opening = name ? card.first_mes.replace(/\{\{\s*char\s*\}\}/gi, name) : card.first_mes;
  return (
    <>
      {issues.length ? (
        <IssueList issues={issues} onPick={onPick} />
      ) : (
        <View style={[styles.ok, { backgroundColor: palette.okBg }]}>
          <Icon name="check" size={14} color={palette.ok} />
          <Text style={{ color: palette.ok, fontSize: 13 }}>{t("workbench.preview.checkOk")}</Text>
        </View>
      )}
      {lengths ? <Block label={t("workbench.preview.lengths")} text={lengths} /> : null}
      {opening.trim() ? (
        <>
          <Text style={{ fontSize: 14, fontWeight: "700", color: palette.ink, paddingTop: space.s }}>
            {t("workbench.preview.openingPreview")}
          </Text>
          <View style={[styles.block, { backgroundColor: palette.card }]}>
            <Text style={{ fontFamily: font.serif, fontSize: 16, lineHeight: 28, color: palette.narr }}>
              {opening.trim()}
            </Text>
          </View>
        </>
      ) : null}
      <Text style={{ fontSize: 12, lineHeight: 18, color: palette.mut }}>
        {t("cardEdit.notice", { user: "{{user}}", char: "{{char}}" })}
      </Text>
    </>
  );
}

export function PreviewSheet({
  visible,
  onClose,
  state,
  cover,
  onOpenCover,
  manual,
}: {
  visible: boolean;
  onClose: () => void;
  state: WorkbenchState;
  cover: CoverActions;
  onOpenCover: () => void;
  /** 手动模式：显示检查（由调用方画好） */
  manual?: ReactNode;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("card");
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      full
      title={manual ? t("workbench.preview.check") : t("workbench.preview.title")}
    >
      {manual ? null : (
        <Segmented
          hideLabel
          label={t("workbench.preview.title")}
          value={tab}
          height={40}
          options={[
            { value: "card", label: t("workbench.preview.tabs.card") },
            { value: "notes", label: t("workbench.preview.tabs.notes"), count: state.draft.notes.length || undefined },
            { value: "images", label: t("workbench.preview.tabs.images"), count: state.draft.assets.length || undefined },
          ]}
          onChange={setTab}
          style={{ marginHorizontal: space.l, marginBottom: space.s }}
        />
      )}
      <ScrollView contentContainerStyle={styles.scroll} style={{ backgroundColor: palette.sheet }}>
        {manual ?? (
          <>
            {tab === "card" ? <CardBody state={state} onOpenCover={onOpenCover} /> : null}
            {tab === "notes" ? <NotesBody state={state} /> : null}
            {tab === "images" ? (
              state.draft.assets.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                  {state.draft.assets.map((asset) => (
                    <AssetTile
                      key={asset.id}
                      asset={asset}
                      width={100}
                      selected={state.draft.cover_asset_id === asset.id}
                      label={t("workbench.messages.useAsCover")}
                      onPress={() => void cover.pick(asset)}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.empty}>{t("workbench.preview.noImages")}</Text>
              )
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: space.l, paddingBottom: 48, gap: space.s },
  cover: {
    height: 180,
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
  },
  block: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  blockHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  empty: { paddingVertical: 32, textAlign: "center", fontSize: 13, opacity: 0.6 },
  ok: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 12 },
});
