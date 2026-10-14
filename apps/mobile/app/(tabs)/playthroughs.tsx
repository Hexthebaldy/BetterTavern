/**
 * 故事列表：最近玩过的在前。左滑或长按可以重命名、删除；正在生成的故事标一个蓝点。
 * 封面跟着剧本：剧本有图片就用图片，否则按剧本 ID 画几何封面。
 */

import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { ApiError, describeError } from "../../src/api/client.ts";
import type { Playthrough } from "../../src/api/types.ts";
import { Cover } from "../../src/components/Cover.tsx";
import { SwipeRow } from "../../src/components/SwipeRow.tsx";
import {
  Button,
  ErrorState,
  Icon,
  LargeHeader,
  Notice,
  SkeletonLine,
  useOverlay,
} from "../../src/components/ui.tsx";
import { displayServer } from "../../src/features/settings/servers.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, size, space, usePalette } from "../../src/theme/index.ts";
import { formatRelative } from "../../src/utils/format.ts";

function StoryRow({
  story,
  avatar,
  onOpen,
  onMenu,
}: {
  story: Playthrough;
  avatar: string | null;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const palette = usePalette();
  const writing = story.active_turn_id !== null;
  const opening = story.head_turn_id === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="打开故事；长按可以重命名或删除"
      onPress={onOpen}
      onLongPress={onMenu}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: palette.line, backgroundColor: pressed ? palette.bg2 : palette.bg },
      ]}
    >
      <Cover seed={story.scenario_id ?? story.id} blobId={avatar} width={size.cover} height={size.cover} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>
            {story.title}
          </Text>
          <Text style={[styles.time, { color: palette.mut }]}>{formatRelative(story.updated_at)}</Text>
        </View>
        {writing ? (
          <View style={styles.live}>
            <View style={[styles.liveDot, { backgroundColor: palette.acc }]} />
            <Text style={[styles.liveText, { color: palette.acc }]}>
              {opening ? "正在写开场" : "正在写下一段"}
            </Text>
          </View>
        ) : null}
        {story.head_excerpt ? (
          <Text numberOfLines={2} style={[styles.excerpt, { color: palette.ink2 }]}>
            {story.head_excerpt}
          </Text>
        ) : opening && !writing ? (
          <View style={styles.live}>
            <Icon name="untested" size={16} color={palette.warn} />
            <Text style={{ fontSize: 13, color: palette.warn }}>开场还没有写好</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Skeleton() {
  const palette = usePalette();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0.7, 0.4].map((opacity, i) => (
        <View key={i} style={[styles.row, { opacity, borderBottomColor: palette.line }]}>
          <View style={{ width: size.cover, height: size.cover, backgroundColor: palette.bg2 }} />
          <View style={[styles.rowBody, { gap: 10, paddingTop: 4 }]}>
            <SkeletonLine strong width={i === 0 ? "45%" : "35%"} height={14} />
            <SkeletonLine width="90%" height={10} />
            {i === 0 ? <SkeletonLine width="70%" height={10} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Empty({ onImport }: { onImport: () => void }) {
  const palette = usePalette();
  return (
    <View style={styles.empty}>
      <Svg width="100%" height={200} viewBox="0 0 342 200" preserveAspectRatio="xMidYMid meet">
        <Rect x={0.5} y={0.5} width={341} height={199} fill={palette.bg2} stroke={palette.line} />
        <Path d="M0 140.5h342" stroke={palette.line} />
        <Path
          d="M171 40v120M101 52h70v96h-70zM171 52h70v96h-70z"
          fill="none"
          stroke={palette.ink}
          strokeWidth={1.5}
        />
        <Path d="M115 72h40M115 84h32M115 96h40M187 72h40M187 84h28" stroke={palette.line2} strokeWidth={3} />
        <Rect x={225} y={120} width={12} height={12} fill={palette.acc} />
      </Svg>
      <Text style={[styles.emptyTitle, { color: palette.ink }]}>还没有故事</Text>
      <Text style={[styles.emptyText, { color: palette.mut }]}>
        去“剧本”导入一张角色卡，设定你扮演的角色，第一段故事就会写出来。
      </Text>
      <Button
        label="去导入角色卡"
        trailingIcon="arrowRight"
        between
        onPress={onImport}
        style={{ marginTop: space.s }}
      />
    </View>
  );
}

export default function PlaythroughsScreen() {
  const { api, serverUrl } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const { data, error, loading, refreshing, reload, refresh, setData } = useAsync(async () => {
    const [stories, scenarios] = await Promise.all([
      api.playthroughs.list(),
      api.scenarios.list().catch(() => []),
    ]);
    return { stories, avatars: new Map(scenarios.map((s) => [s.id, s.avatar_blob_id])) };
  }, [api]);

  const rename = async (story: Playthrough): Promise<void> => {
    const title = await overlay.prompt({
      title: "重命名故事",
      label: "故事标题",
      initial: story.title,
      maxLength: 80,
    });
    if (!title || title === story.title) return;
    try {
      const updated = await api.playthroughs.rename(story.id, title);
      setData(
        (d) => d && { ...d, stories: d.stories.map((s) => (s.id === story.id ? { ...s, ...updated } : s)) },
      );
    } catch (e) {
      overlay.toast(`重命名失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const remove = async (story: Playthrough): Promise<void> => {
    const ok = await overlay.confirm({
      title: `删除“${story.title}”？`,
      message: "删除后故事和世界状态都无法恢复。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.playthroughs.remove(story.id);
      setData((d) => d && { ...d, stories: d.stories.filter((s) => s.id !== story.id) });
      overlay.toast(`已删除“${story.title}”`);
    } catch (e) {
      overlay.toast(`删除失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const menu = async (story: Playthrough): Promise<void> => {
    const key = await overlay.menu({
      title: story.title,
      items: [
        { key: "rename", label: "重命名", icon: "write" },
        { key: "delete", label: "删除", icon: "trash", danger: true },
      ],
    });
    if (key === "rename") void rename(story);
    if (key === "delete") void remove(story);
  };

  const stories = data?.stories;
  const header = <LargeHeader title="故事" count={stories ? stories.length : null} />;

  if (!stories) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        <Skeleton />
        {!loading ? (
          <ErrorState
            title="故事列表没加载出来"
            message={
              error instanceof ApiError && error.isNetwork ? (
                <>
                  连不上服务器{" "}
                  <Text style={{ fontFamily: font.mono, color: palette.ink }}>
                    {displayServer(serverUrl)}
                  </Text>
                  ，检查网络或服务器地址。
                </>
              ) : (
                describeError(error)
              )
            }
            onRetry={() => void reload()}
            style={{ backgroundColor: palette.bg }}
          />
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {header}
      <FlatList
        data={stories}
        keyExtractor={(s) => s.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.mut} />
        }
        ListHeaderComponent={
          error ? (
            <Notice message={describeError(error)} banner actionLabel="重试" onAction={() => void reload()} />
          ) : null
        }
        ListEmptyComponent={<Empty onImport={() => router.navigate("/library")} />}
        renderItem={({ item }) => (
          <SwipeRow
            actions={[
              { key: "rename", label: "重命名", icon: "write", onPress: () => void rename(item) },
              { key: "delete", label: "删除", icon: "trash", danger: true, onPress: () => void remove(item) },
            ]}
          >
            <StoryRow
              story={item}
              avatar={item.scenario_id ? (data.avatars.get(item.scenario_id) ?? null) : null}
              onOpen={() => router.push({ pathname: "/play/[id]", params: { id: item.id } })}
              onMenu={() => void menu(item)}
            />
          </SwipeRow>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: space.l,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  rowBody: { flex: 1, minWidth: 0, gap: space.xs },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  title: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: "700" },
  time: { fontFamily: font.mono, fontSize: 11.5, letterSpacing: 0.4 },
  live: { flexDirection: "row", alignItems: "center", gap: space.s },
  liveDot: { width: 8, height: 8 },
  liveText: { fontFamily: font.monoMedium, fontSize: 11.5, letterSpacing: 0.7 },
  excerpt: { fontSize: 14, lineHeight: 21 },
  empty: { paddingHorizontal: space.read, paddingTop: 48, gap: space.l },
  emptyTitle: { fontSize: 24, lineHeight: 32, fontWeight: "700", letterSpacing: -0.2 },
  emptyText: { fontSize: 15, lineHeight: 24 },
});
