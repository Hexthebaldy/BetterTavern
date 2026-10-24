/**
 * 库页（app/(tabs)/library.tsx）的部件（漫画风，docs/design/comic/mobile/png/10–14、tablet/png/04–05）：
 * 页头的网格 / 列表切换和新建、网格卡片、列表行、空状态。剧本仓库和角色卡仓库共用一种卡片（Item）。
 *
 * - 网格卡片：白底 2.5 墨线的格子（圆角 12），封面在上（底边一道墨线），名字、两行简介、数量在下；
 *   有没保存的草稿的角色卡在封面左上角标“草稿”。
 * - 列表行：左边 2 墨线的方形封面，名字和右端的数量，下面两行简介。
 * 按下换成灰底；长按从底部（平板上贴着卡片）弹出操作。
 */

import { type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CardSummary, Scenario } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { cardOrigin } from "@bettertavern/core/workbench/labels";

import { Cover } from "../../components/Cover.tsx";
import { Button, EmptyPanel, Icon, Pill, press, type IconName } from "../../components/ui.tsx";
import type { LibraryView } from "../../state/PrefsProvider.tsx";
import {
  comicDepth,
  comicRadius,
  comicStroke,
  font,
  space,
  useComic,
} from "../../theme/index.ts";

/** 一格的内容 */
export type Item = {
  id: string;
  title: string;
  summary: string;
  meta?: string;
  coverBlobId: string | null;
  /** 角色卡有没保存的草稿：封面上标“草稿” */
  draft?: boolean;
};

/** saves：用这个剧本开的存档有几个（取自存档列表） */
export function scenarioItem(s: Scenario, saves: number): Item {
  const cast = s.cards.length > 1 ? s.cards.map((c) => c.name).join(i18n.t("common.listSeparator")) : "";
  return {
    id: s.id,
    title: s.name,
    summary: s.description_preview || cast,
    meta: `${i18n.t("library.cardsIn", { count: s.cards.length })} · ${i18n.t("library.savesIn", { count: saves })}`,
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
    draft: !!c.draft_id,
  };
}

// ---- 页头的视图切换和新建 -------------------------------------------------------------------

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
  /** 宽屏：新建是带文字的主按钮 */
  labelled: boolean;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const option = (value: LibraryView, icon: IconName, label: string, first: boolean) => {
    const on = view === value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        onPress={() => onView(value)}
        style={[
          styles.segButton,
          first ? null : { borderLeftWidth: comicStroke.control, borderLeftColor: c.ink },
          { backgroundColor: on ? c.ink : c.paper },
        ]}
      >
        <Icon name={icon} size={18} color={on ? c.paper : c.ink} />
      </Pressable>
    );
  };
  return (
    <View style={styles.controls}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("library.view")}
        style={[styles.seg, { borderColor: c.ink, backgroundColor: c.paper }]}
      >
        {option("grid", "grid", t("library.grid"), true)}
        {option("list", "list", t("library.list"), false)}
      </View>
      {labelled ? (
        <Button label={addLabel} icon={addIcon} onPress={onAdd} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          onPress={onAdd}
          style={({ pressed }) => [
            styles.add,
            { backgroundColor: c.ink, borderColor: c.ink },
            press(pressed, comicDepth.iconButton, c.acc),
          ]}
        >
          <Icon name={addIcon} size={22} color={c.paper} />
        </Pressable>
      )}
    </View>
  );
}

// ---- 网格和列表 -----------------------------------------------------------------------------

/** 网格卡片封面的高度：手机 116，平板 146（按 240 宽的格子） */
function coverHeight(width: number): number {
  return width >= 220 ? 146 : 116;
}

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
  const c = useComic();
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
        { width, borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper },
      ]}
    >
      <TileBody item={item} width={width} />
    </Pressable>
  );
}

/** 平板长按时抬起的卡片：内容和网格卡片一样 */
export function LiftedTile({ item, width }: { item: Item; width: number }) {
  const c = useComic();
  return (
    <View style={[styles.tile, { flex: 1, borderColor: c.ink, backgroundColor: c.paper }]}>
      <TileBody item={item} width={width} />
    </View>
  );
}

/** 网格卡片里的封面和文字 */
function TileBody({ item, width }: { item: Item; width: number }) {
  const c = useComic();
  const { t } = useTranslation();
  const inner = width - comicStroke.frame * 2;
  return (
    <>
      <View style={[styles.tileCover, { borderBottomColor: c.ink }]}>
        <Cover seed={item.id} blobId={item.coverBlobId} width={inner} height={coverHeight(width)} rounded={0} />
        {item.draft ? <Pill tone="ink" label={t("library.draftChip")} style={styles.draft} /> : null}
      </View>
      <View style={styles.tileMeta}>
        <Text numberOfLines={1} style={[styles.name, { color: c.ink }]}>
          {item.title}
        </Text>
        <Text numberOfLines={2} style={[styles.summary, { color: c.ink2 }]}>
          {item.summary}
        </Text>
        {item.meta ? (
          <Text numberOfLines={1} style={[styles.meta, { color: c.mut }]}>
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
  const c = useComic();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper },
      ]}
    >
      <Cover seed={item.id} blobId={item.coverBlobId} width={60} height={60} framed />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: c.ink }]}>
            {item.title}
          </Text>
          {item.meta ? (
            <Text numberOfLines={1} style={[styles.rowMeta, { color: c.mut }]}>
              {item.meta}
            </Text>
          ) : null}
        </View>
        <Text numberOfLines={2} style={[styles.rowSummary, { color: c.ink2 }]}>
          {item.summary}
        </Text>
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
  return (
    <View style={styles.emptyWrap}>
      <EmptyPanel
        icon="library"
        filled="library"
        title={title}
        message={note}
        action={
          <Button
            label={actionLabel}
            trailingIcon={actionIcon}
            between
            onPress={onAction}
            style={{ marginTop: space.s }}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center", gap: 10 },
  seg: {
    flexDirection: "row",
    height: 40,
    borderWidth: comicStroke.control,
    borderRadius: 11,
    overflow: "hidden",
  },
  segButton: { width: 42, alignItems: "center", justifyContent: "center" },
  add: {
    width: 44,
    height: 44,
    borderRadius: comicRadius.iconButton,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  tile: { borderWidth: comicStroke.frame, borderRadius: comicRadius.frame, overflow: "hidden" },
  tileCover: { borderBottomWidth: comicStroke.frame },
  draft: { position: "absolute", left: 8, top: 8 },
  tileMeta: { paddingTop: 10, paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: "900" },
  summary: { fontSize: 13, lineHeight: 20, minHeight: 40 },
  meta: { fontFamily: font.monoMedium, fontSize: 11, lineHeight: 15 },
  row: {
    flexDirection: "row",
    gap: 14,
    padding: 12,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space.s },
  rowTitle: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: "900" },
  rowMeta: { fontFamily: font.monoMedium, fontSize: 11.5, lineHeight: 16 },
  rowSummary: { fontSize: 14, lineHeight: 22 },
  emptyWrap: { paddingHorizontal: 20, paddingTop: space.xs },
});
