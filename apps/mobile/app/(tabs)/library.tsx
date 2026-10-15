/**
 * 剧本库：导入角色卡（PNG 或 JSON，原样上传，服务端解析），网格或列表显示已导入的剧本。
 *
 * 导入成功直接进入剧本详情；之前导入过的弹出墨色浮条“打开”；失败时页面顶上出红色提示条说明原因。
 * 网格里长按、列表里左滑或长按可以重命名、删除。剧本是浅灰圆角卡片，列表底部留出浮动标签栏的位置。
 *
 * 平板（theme/layout.ts）：网格中屏 3 列，宽屏按内容宽度 ÷ 240 取整（最多 5 列），间距 16；列表视图限宽 640、居中。
 * 宽屏的导入按钮换成带文字的胶囊“导入角色卡”；长按卡片时卡片抬起、下方弹出菜单，宽屏不用左滑。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";
import { cellWidth, centerColumn, gap, libraryColumns, tabInsets } from "@bettertavern/design/layout";

import { SwipeRow } from "../../src/components/SwipeRow.tsx";
import {
  ErrorState,
  LargeHeader,
  Loading,
  Notice,
  useOverlay,
  useTabBarSpace,
} from "../../src/components/ui.tsx";
import {
  Empty,
  HeaderControls,
  ImportingTile,
  LiftedTile,
  ImportingRow,
  Row,
  Tile,
  type Importing,
} from "../../src/features/library/LibraryParts.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { radius, space, usePalette } from "../../src/theme/index.ts";

const MAX_BYTES = 16 * 1024 * 1024;

type ImportError = { title: string; message: string };

// ---- 页面 -------------------------------------------------------------------------------

export default function LibraryScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const { libraryView, setLibraryView } = usePrefs();
  const { width, size: layoutSize, compact, expanded } = useLayout();
  const nodes = useRef(new Map<string, View>());
  const { data, error, loading, refreshing, reload, refresh, setData } = useAsync(
    () => api.scenarios.list(),
    [api],
  );
  const { bottom: bottomSpace } = useTabBarSpace();
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

  /** tileWidth 只在平板的网格里传：菜单贴着这张卡片弹出，卡片抬起 */
  const menu = async (s: Scenario, tileWidth?: number): Promise<void> => {
    const anchor = compact ? null : (nodes.current.get(s.id) ?? null);
    const key = await overlay.menu({
      title: s.name,
      items: [
        { key: "rename", label: "重命名", icon: "write" },
        { key: "delete", label: "删除", icon: "trash", danger: true },
      ],
      anchor: anchor ? { current: anchor } : undefined,
      lifted: anchor && tileWidth ? <LiftedTile scenario={s} width={tileWidth} /> : undefined,
      liftedRadius: tileWidth ? 26 : undefined,
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
          labelled={expanded}
        />
      )}
    </LargeHeader>
  );
  // 平板：网格从一级页的留白开始；列表、提示、空状态在居中的内容栏里（≤ 640）
  const sides = tabInsets(layoutSize);
  const column = sides ? centerColumn(width, sides) : null;
  const columnMargins = column ? { marginLeft: column.left, marginRight: column.right } : null;
  const banner = importError ? (
    <Notice
      title={importError.title}
      message={importError.message}
      onClose={() => setImportError(null)}
      style={[styles.banner, columnMargins]}
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
        <View
          style={column ? { paddingLeft: column.left - space.l, paddingRight: column.right - space.l } : null}
        >
          <Empty onImport={() => void importCard()} importing={false} />
        </View>
      </View>
    );
  }

  const grid = libraryView === "grid";
  const listInsets = sides ? (grid ? sides : column) : null;
  const contentWidth = width - (listInsets ? listInsets.left + listInsets.right : space.list * 2);
  const columns = grid ? libraryColumns(layoutSize, contentWidth) : 1;
  const spacing = compact ? space.s : gap.library;
  const tileWidth = compact
    ? (width - space.list * 2 - space.s) / 2
    : cellWidth(contentWidth, columns, spacing);
  const keep = (id: string) => (node: View | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
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
          style={[styles.banner, columnMargins]}
        />
      ) : null}
      <FlatList
        // 列数变了（旋转、分屏）要换一个列表：FlatList 不能在原地改 numColumns
        key={`${libraryView}-${columns}`}
        data={items}
        numColumns={columns}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomSpace },
          listInsets ? { paddingLeft: listInsets.left, paddingRight: listInsets.right } : null,
        ]}
        columnWrapperStyle={grid ? { gap: spacing } : undefined}
        ItemSeparatorComponent={() => <View style={{ height: spacing }} />}
        keyExtractor={(item) => (item.kind === "importing" ? "importing" : item.scenario.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.mut} />
        }
        renderItem={({ item }) => {
          if (item.kind === "importing") {
            return grid ? (
              <ImportingTile file={item.file} width={tileWidth} />
            ) : (
              <ImportingRow file={item.file} />
            );
          }
          const s = item.scenario;
          if (grid) {
            return (
              <Tile
                ref={keep(s.id)}
                scenario={s}
                width={tileWidth}
                onPress={() => open(s.id)}
                onLongPress={() => void menu(s, tileWidth)}
              />
            );
          }
          const row = (
            <Row ref={keep(s.id)} scenario={s} onPress={() => open(s.id)} onLongPress={() => void menu(s)} />
          );
          // 宽屏只用长按
          return expanded ? (
            row
          ) : (
            <SwipeRow
              actions={[
                { key: "rename", label: "重命名", icon: "write", onPress: () => void rename(s) },
                { key: "delete", label: "删除", icon: "trash", danger: true, onPress: () => void remove(s) },
              ]}
            >
              {row}
            </SwipeRow>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.list, paddingTop: space.s },
  banner: { marginHorizontal: space.list, marginBottom: space.s, borderRadius: radius.option },
});
