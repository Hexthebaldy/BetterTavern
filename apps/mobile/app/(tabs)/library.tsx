/**
 * 剧本库：导入角色卡（PNG 或 JSON，原样上传，服务端解析），网格或列表显示已导入的剧本。
 *
 * 导入成功直接进入剧本详情；之前导入过的弹出墨色浮条“打开”；失败时页面顶上出红色提示条说明原因。
 * 网格里长按、列表里左滑或长按可以重命名、删除。剧本是浅灰圆角卡片，列表底部留出浮动标签栏的位置。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { describeError } from "../../src/api/client.ts";
import type { Scenario } from "../../src/api/types.ts";
import { Cover } from "../../src/components/Cover.tsx";
import { SwipeRow } from "../../src/components/SwipeRow.tsx";
import {
  Button,
  ErrorState,
  Icon,
  LargeHeader,
  Loading,
  Notice,
  useOverlay,
  useTabBarSpace,
  type IconName,
} from "../../src/components/ui.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs, type LibraryView } from "../../src/state/PrefsProvider.tsx";
import { font, radius, size, space, usePalette } from "../../src/theme/index.ts";
import { formatBytes } from "../../src/utils/format.ts";

const MAX_BYTES = 16 * 1024 * 1024;

function summary(s: Scenario): string {
  return s.description_preview || s.first_mes_preview || (s.creator ? `作者：${s.creator}` : "");
}

type Importing = { name: string; size: number | undefined };
type ImportError = { title: string; message: string };

// ---- 页头的视图切换和导入按钮 -------------------------------------------------------------------

function HeaderControls({
  view,
  onView,
  importing,
  onImport,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  importing: boolean;
  onImport: () => void;
}) {
  const palette = usePalette();
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
        accessibilityLabel="视图"
        style={[styles.seg, { backgroundColor: palette.bg2 }]}
      >
        {option("grid", "grid", "网格")}
        {option("list", "list", "列表")}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={importing ? "正在导入" : "导入角色卡"}
        accessibilityState={{ disabled: importing, busy: importing }}
        disabled={importing}
        onPress={onImport}
        style={({ pressed }) => [
          styles.add,
          {
            backgroundColor: importing ? palette.bg3 : palette.ink,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
        ]}
      >
        <Icon name="plus" color={importing ? palette.mut : palette.bg} />
      </Pressable>
    </View>
  );
}

// ---- 网格和列表 -----------------------------------------------------------------------------

const TILE_PAD = 8;

function Tile({
  scenario,
  width,
  onPress,
  onLongPress,
}: {
  scenario: Scenario;
  width: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const palette = usePalette();
  const coverWidth = width - TILE_PAD * 2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="打开剧本；长按可以重命名或删除"
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
    </Pressable>
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
function ImportingTile({ file, width }: { file: Importing; width: number }) {
  const palette = usePalette();
  const coverWidth = width - TILE_PAD * 2;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`正在导入 ${file.name}`}
      style={[styles.tile, { width, backgroundColor: palette.bg2 }]}
    >
      <View style={[styles.importCover, { height: (coverWidth * 76) / 96, backgroundColor: palette.card }]}>
        <Spinner />
      </View>
      <View style={styles.tileMeta}>
        <Text style={[styles.name, { color: palette.mut }]}>正在导入</Text>
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

function Row({
  scenario,
  onPress,
  onLongPress,
}: {
  scenario: Scenario;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
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

function Empty({ onImport, importing }: { onImport: () => void; importing: boolean }) {
  const palette = usePalette();
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
            <Text style={[styles.summary, { color: palette.mut, minHeight: 0 }]}>卡面图片里带数据</Text>
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
            <Text style={[styles.summary, { color: palette.mut, minHeight: 0 }]}>纯文本角色卡</Text>
          </View>
        </View>
      </View>
      <View style={[styles.emptyBody, { backgroundColor: palette.bg2 }]}>
        <Text style={[styles.emptyTitle, { color: palette.ink }]}>导入第一张角色卡</Text>
        <View style={styles.specs} accessibilityLabel="支持 SillyTavern V1、V2、V3">
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
            卡里附带的世界书，会转成故事的世界状态。
          </Text>
        </View>
        <Button label="导入角色卡" trailingIcon="import" between busy={importing} onPress={onImport} />
        <Text style={{ fontFamily: font.mono, fontSize: 11.5, color: palette.mut, textAlign: "center" }}>
          .PNG / .JSON · ≤ 16 MB
        </Text>
      </View>
    </View>
  );
}

// ---- 页面 -------------------------------------------------------------------------------

export default function LibraryScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const { libraryView, setLibraryView } = usePrefs();
  const { width } = useWindowDimensions();
  const { data, error, loading, refreshing, reload, refresh, setData } = useAsync(
    () => api.scenarios.list(),
    [api],
  );
  const bottomSpace = useTabBarSpace();
  const [importing, setImporting] = useState<Importing | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);

  const open = (id: string): void => router.push({ pathname: "/scenario/[id]", params: { id } });

  const importCard = async (): Promise<void> => {
    setImportError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const file = picked.assets[0];
    if (!file) return;
    if (!/\.(png|json)$/i.test(file.name)) {
      setImportError({ title: `${file.name} 不是角色卡`, message: "只支持 PNG 或 JSON，最大 16 MB。" });
      return;
    }
    if (file.size !== undefined && file.size > MAX_BYTES) {
      setImportError({ title: `${file.name} 太大了`, message: "角色卡最大 16 MB。" });
      return;
    }
    setImporting({ name: file.name, size: file.size });
    try {
      const scenario = await api.scenarios.importFile(new File(file.uri));
      void reload();
      if (scenario.duplicate) {
        overlay.toast(`“${scenario.name}”之前已经导入过了`, {
          icon: "info",
          actionLabel: "打开",
          onAction: () => open(scenario.id),
        });
      } else {
        open(scenario.id);
      }
    } catch (e) {
      setImportError({ title: `${file.name} 导入失败`, message: describeError(e) });
    } finally {
      setImporting(null);
    }
  };

  const rename = async (s: Scenario): Promise<void> => {
    const name = await overlay.prompt({
      title: "重命名剧本",
      label: "剧本名",
      initial: s.name,
      maxLength: 80,
    });
    if (!name || name === s.name) return;
    try {
      const updated = await api.scenarios.rename(s.id, name);
      setData((list) => list?.map((x) => (x.id === s.id ? updated : x)));
    } catch (e) {
      overlay.toast(`重命名失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const remove = async (s: Scenario): Promise<void> => {
    const ok = await overlay.confirm({
      title: `删除剧本“${s.name}”？`,
      message: "已经开始的故事不受影响。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.scenarios.remove(s.id);
      setData((list) => list?.filter((x) => x.id !== s.id));
      overlay.toast(`已删除“${s.name}”`);
    } catch (e) {
      overlay.toast(`删除失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const menu = async (s: Scenario): Promise<void> => {
    const key = await overlay.menu({
      title: s.name,
      items: [
        { key: "rename", label: "重命名", icon: "write" },
        { key: "delete", label: "删除", icon: "trash", danger: true },
      ],
    });
    if (key === "rename") void rename(s);
    if (key === "delete") void remove(s);
  };

  const empty = data !== undefined && data.length === 0 && !importing;
  const header = (
    <LargeHeader title="剧本">
      {empty || !data ? null : (
        <HeaderControls
          view={libraryView}
          onView={setLibraryView}
          importing={importing !== null}
          onImport={() => void importCard()}
        />
      )}
    </LargeHeader>
  );
  const banner = importError ? (
    <Notice
      title={importError.title}
      message={importError.message}
      onClose={() => setImportError(null)}
      style={styles.banner}
    />
  ) : null;

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        {loading ? (
          <Loading />
        ) : (
          <ErrorState
            title="剧本库没加载出来"
            message={describeError(error)}
            onRetry={() => void reload()}
            style={{ marginTop: space.l }}
          />
        )}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        {banner}
        <Empty onImport={() => void importCard()} importing={false} />
      </View>
    );
  }

  const grid = libraryView === "grid";
  const tileWidth = (width - space.list * 2 - space.s) / 2;
  type Item = { kind: "importing"; file: Importing } | { kind: "scenario"; scenario: Scenario };
  const items: Item[] = [
    ...(importing ? [{ kind: "importing" as const, file: importing }] : []),
    ...data.map((scenario) => ({ kind: "scenario" as const, scenario })),
  ];
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {header}
      {banner}
      {error ? (
        <Notice
          icon="offline"
          message={describeError(error)}
          actionLabel="重试"
          onAction={() => void reload()}
          style={styles.banner}
        />
      ) : null}
      <FlatList
        key={libraryView}
        data={items}
        numColumns={grid ? 2 : 1}
        contentContainerStyle={[styles.list, { paddingBottom: bottomSpace }]}
        columnWrapperStyle={grid ? { gap: space.s } : undefined}
        ItemSeparatorComponent={() => <View style={{ height: space.s }} />}
        keyExtractor={(item) => (item.kind === "importing" ? "importing" : item.scenario.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.mut} />
        }
        renderItem={({ item }) => {
          if (item.kind === "importing") {
            return grid ? (
              <ImportingTile file={item.file} width={tileWidth} />
            ) : (
              <View style={[styles.row, { backgroundColor: palette.bg2, alignItems: "center" }]}>
                <Spinner size={32} />
                <Text style={{ flex: 1, color: palette.mut }} numberOfLines={1}>
                  正在导入 {item.file.name}
                </Text>
              </View>
            );
          }
          const s = item.scenario;
          if (grid) {
            return (
              <Tile
                scenario={s}
                width={tileWidth}
                onPress={() => open(s.id)}
                onLongPress={() => void menu(s)}
              />
            );
          }
          return (
            <SwipeRow
              actions={[
                { key: "rename", label: "重命名", icon: "write", onPress: () => void rename(s) },
                { key: "delete", label: "删除", icon: "trash", danger: true, onPress: () => void remove(s) },
              ]}
            >
              <Row scenario={s} onPress={() => open(s.id)} onLongPress={() => void menu(s)} />
            </SwipeRow>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center", gap: space.s },
  seg: { flexDirection: "row", gap: 2, padding: 3, borderRadius: 22 },
  segButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: space.list, paddingTop: space.s },
  banner: { marginHorizontal: space.list, marginBottom: space.s, borderRadius: radius.option },
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
