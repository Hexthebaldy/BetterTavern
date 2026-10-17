/**
 * 剧本库（app/(tabs)/library.tsx）的部件：页头的视图切换和导入按钮、网格卡片、列表行、导入中的那一格、空状态。
 */

import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import type { Scenario } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { formatBytes } from "@bettertavern/core/utils/format";

import { Cover } from "../../components/Cover.tsx";
import { Button, Icon, type IconName } from "../../components/ui.tsx";
import type { LibraryView } from "../../state/PrefsProvider.tsx";
import { font, radius, size, space, usePalette } from "../../theme/index.ts";

export function summary(s: Scenario): string {
  return (
    s.description_preview ||
    s.first_mes_preview ||
    (s.creator ? i18n.t("library.byCreator", { creator: s.creator }) : "")
  );
}

export type Importing = { name: string; size: number | undefined };

// ---- 页头的视图切换和导入按钮 -------------------------------------------------------------------

export function HeaderControls({
  view,
  onView,
  importing,
  onImport,
  labelled,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  importing: boolean;
  onImport: () => void;
  /** 宽屏：导入按钮是带文字的胶囊 */
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
        accessibilityLabel={importing ? t("library.importing") : t("library.import")}
        accessibilityState={{ disabled: importing, busy: importing }}
        disabled={importing}
        onPress={onImport}
        style={({ pressed }) => [
          labelled ? styles.addPill : styles.add,
          {
            backgroundColor: importing ? palette.bg3 : palette.ink,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
        ]}
      >
        <Icon name="plus" size={labelled ? 18 : 22} color={importing ? palette.mut : palette.bg} />
        {labelled ? (
          <Text style={{ fontSize: 15, fontWeight: "500", color: importing ? palette.mut : palette.bg }}>
            {t("library.import")}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

// ---- 网格和列表 -----------------------------------------------------------------------------

const TILE_PAD = 8;

export function Tile({
  ref,
  scenario,
  width,
  onPress,
  onLongPress,
}: {
  ref?: Ref<View>;
  scenario: Scenario;
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
      <TileBody scenario={scenario} width={width} />
    </Pressable>
  );
}

/** 平板长按时抬起的卡片：内容和网格卡片一样，底色由菜单画成白色 */
export function LiftedTile({ scenario, width }: { scenario: Scenario; width: number }) {
  return (
    <View style={[styles.tile, { flex: 1 }]}>
      <TileBody scenario={scenario} width={width} />
    </View>
  );
}

/** 网格卡片里的封面和文字 */
function TileBody({ scenario, width }: { scenario: Scenario; width: number }) {
  const palette = usePalette();
  const coverWidth = width - TILE_PAD * 2;
  return (
    <>
      <Cover
        seed={scenario.id}
        blobId={scenario.avatar_blob_id}
        width={coverWidth}
        height={(coverWidth * 76) / 96}
        surface="card"
        rounded={18}
      />
      <View style={styles.tileMeta}>
        <Text numberOfLines={1} style={[styles.name, { color: palette.ink }]}>
          {scenario.name}
        </Text>
        <Text numberOfLines={2} style={[styles.summary, { color: palette.mut }]}>
          {summary(scenario)}
        </Text>
      </View>
    </>
  );
}

/** 一直在转的圆弧：表示在传，不代表进度 */
function Spinner({ size: d = 56 }: { size?: number }) {
  const palette = usePalette();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Svg width={d} height={d} viewBox="0 0 56 56">
        <Circle cx={28} cy={28} r={22} fill="none" stroke={palette.bg3} strokeWidth={5} />
        <Path
          d="M28 6a22 22 0 0119.8 31.6"
          fill="none"
          stroke={palette.acc}
          strokeWidth={5}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

/** 网格里“正在导入”的那一格 */
export function ImportingTile({ file, width }: { file: Importing; width: number }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const coverWidth = width - TILE_PAD * 2;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t("library.importingFile", { name: file.name })}
      style={[styles.tile, { width, backgroundColor: palette.bg2 }]}
    >
      <View style={[styles.importCover, { height: (coverWidth * 76) / 96, backgroundColor: palette.card }]}>
        <Spinner />
      </View>
      <View style={styles.tileMeta}>
        <Text style={[styles.name, { color: palette.mut }]}>{t("library.importing")}</Text>
        <Text
          numberOfLines={2}
          style={[styles.summary, { fontFamily: font.mono, fontSize: 11.5, color: palette.mut }]}
        >
          {file.name}
          {file.size !== undefined ? ` · ${formatBytes(file.size)}` : ""}
        </Text>
      </View>
    </View>
  );
}

/** 列表视图里“正在导入”的那一行 */
export function ImportingRow({ file }: { file: Importing }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t("library.importingFile", { name: file.name })}
      style={[styles.row, { backgroundColor: palette.bg2, alignItems: "center" }]}
    >
      <Spinner size={32} />
      <Text style={{ flex: 1, color: palette.mut }} numberOfLines={1}>
        {t("library.importingFile", { name: file.name })}
      </Text>
    </View>
  );
}

export function Row({
  ref,
  scenario,
  onPress,
  onLongPress,
}: {
  ref?: Ref<View>;
  scenario: Scenario;
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
        seed={scenario.id}
        blobId={scenario.avatar_blob_id}
        width={size.cover}
        height={size.cover}
        surface="card"
      />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.ink }]}>
          {scenario.name}
        </Text>
        <Text numberOfLines={2} style={[styles.rowSummary, { color: palette.ink2 }]}>
          {summary(scenario)}
        </Text>
      </View>
    </Pressable>
  );
}

// ---- 空状态 ------------------------------------------------------------------------------

export function Empty({ onImport, importing }: { onImport: () => void; importing: boolean }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const doc = (inner: ReactNode) => (
    <Svg width={44} height={52} viewBox="0 0 44 52">
      <Path
        d="M8 2h20l14 14v28a6 6 0 01-6 6H8a6 6 0 01-6-6V8a6 6 0 016-6z"
        fill={palette.card}
        stroke={palette.ink}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M28 2v10a4 4 0 004 4h10" fill="none" stroke={palette.ink} strokeWidth={1.8} />
      {inner}
    </Svg>
  );
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.kinds}>
        <View style={[styles.kind, { backgroundColor: palette.bg2 }]}>
          {doc(
            <>
              <Rect x={10} y={24} width={20} height={16} rx={4} fill={palette.bg2} />
              <Circle cx={24} cy={29} r={3} fill={palette.acc} />
            </>,
          )}
          <View>
            <Text style={{ fontWeight: "700", color: palette.ink }}>PNG</Text>
            <Text style={[styles.summary, { color: palette.mut, minHeight: 0 }]}>{t("library.pngNote")}</Text>
          </View>
        </View>
        <View style={[styles.kind, { backgroundColor: palette.bg2 }]}>
          {doc(
            <Path
              d="M14 26l-5 6 5 6M30 26l5 6-5 6M20 40l4-16"
              fill="none"
              stroke={palette.ink}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />,
          )}
          <View>
            <Text style={{ fontWeight: "700", color: palette.ink }}>JSON</Text>
            <Text style={[styles.summary, { color: palette.mut, minHeight: 0 }]}>
              {t("library.jsonNote")}
            </Text>
          </View>
        </View>
      </View>
      <View style={[styles.emptyBody, { backgroundColor: palette.bg2 }]}>
        <Text style={[styles.emptyTitle, { color: palette.ink }]}>{t("library.emptyTitle")}</Text>
        <View style={styles.specs} accessibilityLabel={t("library.supports")}>
          {["SillyTavern", "V1", "V2", "V3"].map((label, i) => (
            <View
              key={label}
              style={[styles.spec, { backgroundColor: i === 0 ? palette.card : palette.ink }]}
            >
              <Text
                style={{ fontFamily: font.mono, fontSize: 12, color: i === 0 ? palette.ink : palette.bg }}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.note}>
          <View style={[styles.noteIcon, { backgroundColor: palette.card }]}>
            <Icon name="world" size={18} color={palette.ink2} />
          </View>
          <Text style={{ flex: 1, paddingTop: 5, fontSize: 14, lineHeight: 22, color: palette.ink2 }}>
            {t("library.bookNote")}
          </Text>
        </View>
        <Button
          label={t("library.import")}
          trailingIcon="import"
          between
          busy={importing}
          onPress={onImport}
        />
        <Text style={{ fontFamily: font.mono, fontSize: 11.5, color: palette.mut, textAlign: "center" }}>
          .PNG / .JSON · ≤ 16 MB
        </Text>
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
  importCover: { borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tileMeta: { paddingTop: 10, paddingHorizontal: space.s, paddingBottom: space.s, gap: 3 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  summary: { fontSize: 12.5, lineHeight: 18, minHeight: 36 },
  row: { flexDirection: "row", gap: 14, padding: 14, borderRadius: radius.option },
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  rowSummary: { fontSize: 14, lineHeight: 21 },
  emptyWrap: { paddingHorizontal: space.l, paddingTop: space.s, gap: 10 },
  kinds: { flexDirection: "row", gap: space.s },
  kind: { flex: 1, padding: 20, borderRadius: 26, gap: 14 },
  emptyBody: { paddingVertical: space.page, paddingHorizontal: 20, borderRadius: 26, gap: space.l },
  emptyTitle: { fontSize: 22, lineHeight: 30, fontWeight: "700" },
  specs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  spec: { height: 30, paddingHorizontal: space.m, borderRadius: 15, justifyContent: "center" },
  note: { flexDirection: "row", gap: space.m, alignItems: "flex-start" },
  noteIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
