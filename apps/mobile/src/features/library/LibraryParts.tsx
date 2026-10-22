/**
 * “剧本”页（app/(tabs)/library.tsx）的部件：页头的视图切换和加号、网格卡片、列表行、空状态。
 * 剧本仓库和角色卡仓库共用一种卡片（Item）。
 */

import { type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CardSummary, Scenario } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { cardOrigin } from "@bettertavern/core/workbench/labels";

import { Cover } from "../../components/Cover.tsx";
import { Button, Icon, type IconName } from "../../components/ui.tsx";
import type { LibraryView } from "../../state/PrefsProvider.tsx";
import { radius, size, space, usePalette } from "../../theme/index.ts";

/** 一格的内容 */
export type Item = { id: string; title: string; summary: string; meta?: string; coverBlobId: string | null };

export function scenarioItem(s: Scenario): Item {
  const cast = s.cards.length > 1 ? s.cards.map((c) => c.name).join(i18n.t("common.listSeparator")) : "";
  return {
    id: s.id,
    title: s.name,
    summary: s.description_preview || cast,
    meta: s.cards.length > 1 ? i18n.t("library.cardsIn", { count: s.cards.length }) : undefined,
    coverBlobId: s.cover_blob_id,
  };
}

export function cardItem(c: CardSummary): Item {
  const meta = [
    cardOrigin(c),
    c.scenario_count ? i18n.t("library.usedBy", { count: c.scenario_count }) : "",
    c.draft_id ? i18n.t("library.unsavedDraft") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: c.id,
    title: c.name,
    summary: c.description_preview || (c.creator ? i18n.t("library.byCreator", { creator: c.creator }) : ""),
    meta,
    coverBlobId: c.cover_blob_id,
  };
}

// ---- 页头的视图切换和加号 -------------------------------------------------------------------

export function HeaderControls({
  view,
  onView,
  addLabel,
  addIcon,
  onAdd,
  labelled,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  addLabel: string;
  addIcon: IconName;
  onAdd: () => void;
  /** 宽屏：加号是带文字的胶囊 */
  labelled: boolean;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const option = (value: LibraryView, icon: IconName, label: string) => {
    const on = view === value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        onPress={() => onView(value)}
        style={[
          styles.segButton,
          on ? { backgroundColor: palette.card, boxShadow: palette.shadowLift } : null,
        ]}
      >
        <Icon name={icon} size={18} color={on ? palette.ink : palette.mut} />
      </Pressable>
    );
  };
  return (
    <View style={styles.controls}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("library.view")}
        style={[styles.seg, { backgroundColor: palette.bg2 }]}
      >
        {option("grid", "grid", t("library.grid"))}
        {option("list", "list", t("library.list"))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={addLabel}
        onPress={onAdd}
        style={({ pressed }) => [
          labelled ? styles.addPill : styles.add,
          { backgroundColor: palette.ink, transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}
      >
        <Icon name={addIcon} size={labelled ? 18 : 22} color={palette.bg} />
        {labelled ? (
          <Text style={{ fontSize: 15, fontWeight: "500", color: palette.bg }}>{addLabel}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

// ---- 网格和列表 -----------------------------------------------------------------------------

const TILE_PAD = 8;

export function Tile({
  ref,
  item,
  width,
  onPress,
  onLongPress,
}: {
  ref?: Ref<View>;
  item: Item;
  width: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityHint={t("library.cardHint")}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.tile,
        {
          width,
          backgroundColor: pressed ? palette.bg3 : palette.bg2,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <TileBody item={item} width={width} />
    </Pressable>
  );
}

/** 平板长按时抬起的卡片：内容和网格卡片一样，底色由菜单画成白色 */
export function LiftedTile({ item, width }: { item: Item; width: number }) {
  return (
    <View style={[styles.tile, { flex: 1 }]}>
      <TileBody item={item} width={width} />
    </View>
  );
}

/** 网格卡片里的封面和文字 */
function TileBody({ item, width }: { item: Item; width: number }) {
  const palette = usePalette();
  const coverWidth = width - TILE_PAD * 2;
  return (
    <>
      <Cover
        seed={item.id}
        blobId={item.coverBlobId}
        width={coverWidth}
        height={(coverWidth * 76) / 96}
        surface="card"
        rounded={18}
      />
      <View style={styles.tileMeta}>
        <Text numberOfLines={1} style={[styles.name, { color: palette.ink }]}>
          {item.title}
        </Text>
        <Text numberOfLines={2} style={[styles.summary, { color: palette.mut }]}>
          {item.summary}
        </Text>
        {item.meta ? (
          <Text numberOfLines={1} style={[styles.meta, { color: palette.mut }]}>
            {item.meta}
          </Text>
        ) : null}
      </View>
    </>
  );
}

export function Row({
  ref,
  item,
  onPress,
  onLongPress,
}: {
  ref?: Ref<View>;
  item: Item;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? palette.bg3 : palette.bg2, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <Cover
        seed={item.id}
        blobId={item.coverBlobId}
        width={size.cover}
        height={size.cover}
        surface="card"
      />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.ink }]}>
          {item.title}
        </Text>
        <Text numberOfLines={2} style={[styles.rowSummary, { color: palette.ink2 }]}>
          {item.summary}
        </Text>
        {item.meta ? (
          <Text numberOfLines={1} style={[styles.meta, { color: palette.mut }]}>
            {item.meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---- 空状态 ------------------------------------------------------------------------------

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
  const palette = usePalette();
  return (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyBody, { backgroundColor: palette.bg2 }]}>
        <Text style={[styles.emptyTitle, { color: palette.ink }]}>{title}</Text>
        <View style={styles.note}>
          <View style={[styles.noteIcon, { backgroundColor: palette.card }]}>
            <Icon name="card" size={18} color={palette.ink2} />
          </View>
          <Text style={{ flex: 1, paddingTop: 5, fontSize: 14, lineHeight: 22, color: palette.ink2 }}>{note}</Text>
        </View>
        <Button label={actionLabel} trailingIcon={actionIcon} between onPress={onAction} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center", gap: space.s },
  seg: { flexDirection: "row", gap: 2, padding: 3, borderRadius: 22 },
  segButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  addPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingLeft: 14,
    paddingRight: 18,
    borderRadius: 22,
  },
  tile: { padding: TILE_PAD, borderRadius: 26 },
  tileMeta: { paddingTop: 10, paddingHorizontal: space.s, paddingBottom: space.s, gap: 3 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  summary: { fontSize: 12.5, lineHeight: 18, minHeight: 36 },
  meta: { fontSize: 11.5, lineHeight: 16 },
  row: { flexDirection: "row", gap: 14, padding: 14, borderRadius: radius.option },
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  rowSummary: { fontSize: 14, lineHeight: 21 },
  emptyWrap: { paddingHorizontal: space.l, paddingTop: space.s, gap: 10 },
  emptyBody: { paddingVertical: space.page, paddingHorizontal: 20, borderRadius: 26, gap: space.l },
  emptyTitle: { fontSize: 22, lineHeight: 30, fontWeight: "700" },
  note: { flexDirection: "row", gap: space.m, alignItems: "flex-start" },
  noteIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
