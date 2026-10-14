/**
 * 剧本库：导入角色卡（PNG 或 JSON，原样上传，服务端解析），网格或列表显示已导入的剧本。
 *
 * 导入成功直接进入剧本详情；之前导入过的弹出墨色浮条“打开”；失败时页面顶上出红色提示条说明原因。
 * 网格里长按、列表里左滑或长按可以重命名、删除。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

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
  type IconName,
} from "../../src/components/ui.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs, type LibraryView } from "../../src/state/PrefsProvider.tsx";
import { font, size, space, usePalette } from "../../src/theme/index.ts";
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
        style={[styles.square, { backgroundColor: on ? palette.ink : "transparent" }]}
      >
        <Icon name={icon} size={18} color={on ? palette.bg : palette.mut} />
      </Pressable>
    );
  };
  return (
    <View style={styles.controls}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="视图"
        style={[styles.seg, { borderColor: palette.line2 }]}
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
        style={[styles.square, { backgroundColor: importing ? palette.bg3 : palette.ink }]}
      >
        <Icon name="plus" color={importing ? palette.mut : palette.bg} />
      </Pressable>
    </View>
  );
}

// ---- 网格和列表 -----------------------------------------------------------------------------

function Tile({
  scenario,
  width,
  onPress,
  onLongPress,
  right,
}: {
  scenario: Scenario;
  width: number;
  onPress: () => void;
  onLongPress: () => void;
  right: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="打开剧本；长按可以重命名或删除"
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.tile,
        { width, borderColor: palette.line, backgroundColor: pressed ? palette.bg2 : palette.bg },
        right ? { borderRightWidth: 0 } : null,
      ]}
    >
      <Cover
        seed={scenario.id}
        blobId={scenario.avatar_blob_id}
        width={width - 1}
        height={((width - 1) * 80) / 96}
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

/** 网格里“正在导入”的那一格：底边一段蓝线来回扫，表示在传，不代表进度 */
function ImportingTile({ file, width }: { file: Importing; width: number }) {
  const palette = usePalette();
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const coverHeight = ((width - 1) * 80) / 96;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`正在导入 ${file.name}`}
      style={[styles.tile, { width, borderColor: palette.line }]}
    >
      <View
        style={{
          height: coverHeight,
          backgroundColor: palette.bg2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg width={60} height={60} viewBox="0 0 60 60">
          <Rect
            x={0.75}
            y={0.75}
            width={58.5}
            height={58.5}
            fill="none"
            stroke={palette.line2}
            strokeWidth={1.5}
          />
          <Path d="M0.75 0.75h58.5v26" fill="none" stroke={palette.ink} strokeWidth={1.5} />
        </Svg>
        <View style={[styles.track, { backgroundColor: palette.line }]}>
          <Animated.View
            style={[
              styles.sweep,
              {
                width: width * 0.4,
                backgroundColor: palette.acc,
                transform: [
                  { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, width * 0.6] }) },
                ],
              },
            ]}
          />
        </View>
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
        { borderBottomColor: palette.line, backgroundColor: pressed ? palette.bg2 : palette.bg },
      ]}
    >
      <Cover seed={scenario.id} blobId={scenario.avatar_blob_id} width={size.cover} height={size.cover} />
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
    <Svg width={52} height={64} viewBox="0 0 52 64">
      <Path d="M1 1h36l14 14v48H1z" fill={palette.bg} stroke={palette.ink} strokeWidth={1.5} />
      <Path d="M37 1v14h14" fill="none" stroke={palette.ink} strokeWidth={1.5} />
      {inner}
    </Svg>
  );
  return (
    <View>
      <View style={[styles.kinds, { borderBottomColor: palette.line }]}>
        <View style={[styles.kind, { borderRightWidth: 1, borderRightColor: palette.line }]}>
          {doc(
            <>
              <Rect x={9} y={26} width={24} height={20} fill={palette.bg2} stroke={palette.line2} />
              <Rect x={24} y={30} width={5} height={5} fill={palette.acc} />
            </>,
          )}
          <View>
            <Text style={{ fontWeight: "700", color: palette.ink }}>PNG</Text>
            <Text style={[styles.summary, { color: palette.mut }]}>卡面图片里带数据</Text>
          </View>
        </View>
        <View style={styles.kind}>
          {doc(
            <Path
              d="M14 28l-5 6 5 6M38 28l5 6-5 6M24 44l4-20"
              fill="none"
              stroke={palette.ink}
              strokeWidth={1.5}
            />,
          )}
          <View>
            <Text style={{ fontWeight: "700", color: palette.ink }}>JSON</Text>
            <Text style={[styles.summary, { color: palette.mut }]}>纯文本角色卡</Text>
          </View>
        </View>
      </View>
      <View style={styles.emptyBody}>
        <Text style={[styles.emptyTitle, { color: palette.ink }]}>导入第一张角色卡</Text>
        <View style={{ flexDirection: "row" }} accessibilityLabel="支持 SillyTavern V1、V2、V3">
          {["SillyTavern", "V1", "V2", "V3"].map((label, i) => (
            <View
              key={label}
              style={[
                styles.spec,
                i === 0
                  ? { borderWidth: 1, borderColor: palette.line2 }
                  : {
                      backgroundColor: palette.ink,
                      borderLeftWidth: i > 1 ? 1 : 0,
                      borderLeftColor: palette.bg,
                    },
              ]}
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
          <Icon name="world" size={20} color={palette.ink2} />
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 22, color: palette.ink2 }}>
            卡里附带的世界书，会转成故事的世界状态。
          </Text>
        </View>
        <Button
          label="导入角色卡"
          trailingIcon="import"
          between
          busy={importing}
          onPress={onImport}
          style={{ marginTop: 6 }}
        />
        <Text style={{ fontFamily: font.mono, fontSize: 11.5, letterSpacing: 0.5, color: palette.mut }}>
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
      banner
      title={importError.title}
      message={importError.message}
      onClose={() => setImportError(null)}
    />
  ) : null;

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        {loading ? (
          <Loading />
        ) : (
          <ErrorState title="剧本库没加载出来" message={describeError(error)} onRetry={() => void reload()} />
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
  const tileWidth = width / 2;
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
        <Notice banner message={describeError(error)} actionLabel="重试" onAction={() => void reload()} />
      ) : null}
      <FlatList
        key={libraryView}
        data={items}
        numColumns={grid ? 2 : 1}
        keyExtractor={(item) => (item.kind === "importing" ? "importing" : item.scenario.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.mut} />
        }
        renderItem={({ item, index }) => {
          if (item.kind === "importing") {
            return grid ? (
              <ImportingTile file={item.file} width={tileWidth} />
            ) : (
              <View style={[styles.row, { borderBottomColor: palette.line }]}>
                <Text style={{ color: palette.mut }}>正在导入 {item.file.name}</Text>
              </View>
            );
          }
          const s = item.scenario;
          if (grid) {
            return (
              <Tile
                scenario={s}
                width={tileWidth}
                right={index % 2 === 1}
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
  seg: { flexDirection: "row", borderWidth: 1 },
  square: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  tile: { borderRightWidth: 1, borderBottomWidth: 1 },
  tileMeta: { paddingTop: space.m, paddingHorizontal: 14, paddingBottom: space.l, gap: space.xs },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  summary: { fontSize: 12.5, lineHeight: 18, minHeight: 36 },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, overflow: "hidden" },
  sweep: { height: 3 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: space.l,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  rowSummary: { fontSize: 14, lineHeight: 21 },
  kinds: { flexDirection: "row", borderBottomWidth: 1 },
  kind: { flex: 1, paddingVertical: space.read, paddingHorizontal: space.page, gap: 14 },
  emptyBody: { paddingHorizontal: space.page, paddingTop: 40, gap: 18 },
  emptyTitle: { fontSize: 24, lineHeight: 32, fontWeight: "700", letterSpacing: -0.2 },
  spec: { height: 32, paddingHorizontal: space.m, justifyContent: "center" },
  note: { flexDirection: "row", gap: space.m, alignItems: "flex-start" },
});
