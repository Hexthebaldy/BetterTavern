/**
 * 故事列表：每个故事一张灰色圆角卡片，最近玩过的在前。左滑或长按可以重命名、删除；
 * 正在生成的故事带一个蓝色“正在写”胶囊。封面跟着剧本：有图片就用图片，否则按剧本 ID 画几何封面。
 * 列表底部留出浮动标签栏的位置。
 *
 * 平板（theme/layout.ts）：卡片排成网格，中屏 2 列、宽屏 3 列，间距 12；最近一个故事放大成主卡
 * （中屏占满一行、宽屏占两列，高两行）。中屏保留左滑；宽屏只用长按，卡片抬起、下方弹出菜单。
 * 加载失败、空状态放在居中的内容栏里，宽不超过 640。
 */

import { useRouter } from "expo-router";
import { useRef, type ReactNode } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { ApiError, describeError } from "../../src/api/client.ts";
import type { Playthrough } from "../../src/api/types.ts";
import { Cover } from "../../src/components/Cover.tsx";
import { SwipeRow } from "../../src/components/SwipeRow.tsx";
import {
  Button,
  LargeHeader,
  Notice,
  Pill,
  SkeletonLine,
  useOverlay,
  useTabBarSpace,
} from "../../src/components/ui.tsx";
import { displayServer } from "../../src/features/settings/servers.ts";
import {
  LiftedStory,
  STORY_CARD_HEIGHT,
  STORY_HERO_RADIUS,
  StoryCard,
  StoryHero,
} from "../../src/features/stories/StoryCards.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { font, radius, size, space, usePalette } from "../../src/theme/index.ts";
import {
  cellWidth,
  centerColumn,
  gap,
  storyColumns,
  tabInsets,
  type Insets,
  type SizeClass,
} from "../../src/theme/layout.ts";
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
        { backgroundColor: pressed ? palette.bg3 : palette.bg2, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <Cover
        seed={story.scenario_id ?? story.id}
        blobId={avatar}
        width={size.cover}
        height={size.cover}
        surface="card"
      />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>
            {story.title}
          </Text>
          <Text style={[styles.time, { color: palette.mut }]}>{formatRelative(story.updated_at)}</Text>
        </View>
        {writing ? <Pill tone="acc" dot label={opening ? "正在写开场" : "正在写下一段"} /> : null}
        {story.head_excerpt ? (
          <Text numberOfLines={2} style={[styles.excerpt, { color: palette.ink2 }]}>
            {story.head_excerpt}
          </Text>
        ) : opening && !writing ? (
          <Pill tone="warn" icon="untested" label="开场还没有写好" />
        ) : null}
      </View>
    </Pressable>
  );
}

function Skeleton() {
  const palette = usePalette();
  return (
    <View
      style={[styles.list, { gap: space.s }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0.8, 0.5].map((opacity, i) => (
        <View key={i} style={[styles.row, { opacity, backgroundColor: palette.bg2 }]}>
          <View
            style={{
              width: size.cover,
              height: size.cover,
              borderRadius: radius.cover,
              backgroundColor: palette.card,
            }}
          />
          <View style={[styles.rowBody, { gap: 10, paddingTop: 4 }]}>
            <SkeletonLine strong width={i === 0 ? "45%" : "35%"} height={14} />
            <SkeletonLine strong width="90%" height={10} />
            {i === 0 ? <SkeletonLine strong width="70%" height={10} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Empty({ onImport }: { onImport: () => void }) {
  const palette = usePalette();
  return (
    <View style={[styles.empty, { backgroundColor: palette.bg2 }]}>
      <Svg width="100%" height={150} viewBox="0 0 294 150" preserveAspectRatio="xMidYMid meet">
        <Rect width={294} height={150} rx={24} fill={palette.card} />
        <Path
          d="M147 40c-14-10-34-14-60-14v84c26 0 46 4 60 14 14-10 34-14 60-14V26c-26 0-46 4-60 14z"
          fill="none"
          stroke={palette.ink}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <Path d="M147 40v84" stroke={palette.ink} strokeWidth={2} />
        <Path
          d="M104 56h28M104 70h22M162 56h28M162 70h20"
          stroke={palette.line2}
          strokeWidth={5}
          strokeLinecap="round"
        />
        <Circle cx={214} cy={40} r={10} fill={palette.acc} />
      </Svg>
      <Text style={[styles.emptyTitle, { color: palette.ink }]}>还没有故事</Text>
      <Text style={[styles.emptyText, { color: palette.mut }]}>
        去“剧本”导入一张角色卡，设定你扮演的角色，第一段故事就会写出来。
      </Text>
      <Button label="去导入角色卡" trailingIcon="arrowRight" between onPress={onImport} />
    </View>
  );
}

/**
 * 平板的故事网格。主卡在左上：中屏占满一行，宽屏占两列，右边一列竖着放第 2、3 个故事；其余按列数往下排。
 * 中屏的卡片仍可以左滑。
 */
function StoryGrid({
  stories,
  avatars,
  size: layoutSize,
  contentWidth,
  onOpen,
  onMenu,
  swipeActions,
}: {
  stories: Playthrough[];
  avatars: Map<string, string | null>;
  size: SizeClass;
  contentWidth: number;
  onOpen: (story: Playthrough) => void;
  onMenu: (story: Playthrough, anchor: View | null, hero: number | null) => void;
  swipeActions: (story: Playthrough) => Parameters<typeof SwipeRow>[0]["actions"];
}) {
  const nodes = useRef(new Map<string, View>());
  const columns = storyColumns(layoutSize);
  const cell = cellWidth(contentWidth, columns, gap.card);
  const expanded = layoutSize === "expanded";
  const heroWidth = expanded ? cell * 2 + gap.card : contentWidth;
  const heroHeight = STORY_CARD_HEIGHT * 2 + gap.card;
  const coverSize = expanded ? 148 : 132;
  const avatar = (s: Playthrough): string | null =>
    s.scenario_id ? (avatars.get(s.scenario_id) ?? null) : null;
  const keep = (id: string) => (node: View | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
  // 中屏保留左滑，宽屏只用长按
  const swipe = (story: Playthrough, card: ReactNode): ReactNode =>
    expanded ? (
      <View key={story.id}>{card}</View>
    ) : (
      <SwipeRow key={story.id} actions={swipeActions(story)}>
        {card}
      </SwipeRow>
    );
  const small = (story: Playthrough): ReactNode =>
    swipe(
      story,
      <StoryCard
        ref={keep(story.id)}
        story={story}
        avatar={avatar(story)}
        width={cell}
        onOpen={() => onOpen(story)}
        onMenu={() => onMenu(story, nodes.current.get(story.id) ?? null, null)}
      />,
    );

  const [first, ...others] = stories;
  if (!first) return null;
  const beside = expanded ? others.slice(0, 2) : [];
  const rest = expanded ? others.slice(2) : others;
  return (
    <View style={{ gap: gap.card }}>
      <View style={{ flexDirection: "row", gap: gap.card }}>
        {swipe(
          first,
          <StoryHero
            ref={keep(first.id)}
            story={first}
            avatar={avatar(first)}
            width={heroWidth}
            height={heroHeight}
            coverSize={coverSize}
            onOpen={() => onOpen(first)}
            onMenu={() => onMenu(first, nodes.current.get(first.id) ?? null, coverSize)}
          />,
        )}
        {beside.length > 0 ? <View style={{ gap: gap.card }}>{beside.map(small)}</View> : null}
      </View>
      {rest.length > 0 ? <View style={styles.wrap}>{rest.map(small)}</View> : null}
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

  /** anchor 和 hero 只在平板上用：菜单贴着这张卡片弹出，卡片抬起 */
  const menu = async (story: Playthrough, anchor?: View | null, hero?: number | null): Promise<void> => {
    const avatar = story.scenario_id ? (data?.avatars.get(story.scenario_id) ?? null) : null;
    const key = await overlay.menu({
      title: story.title,
      items: [
        { key: "rename", label: "重命名", icon: "write" },
        { key: "delete", label: "删除", icon: "trash", danger: true },
      ],
      anchor: anchor ? { current: anchor } : undefined,
      lifted: anchor ? <LiftedStory story={story} avatar={avatar} hero={hero ?? undefined} /> : undefined,
      liftedRadius: hero ? STORY_HERO_RADIUS : undefined,
    });
    if (key === "rename") void rename(story);
    if (key === "delete") void remove(story);
  };

  const { bottom: bottomSpace } = useTabBarSpace();
  const { size: layoutSize, width } = useLayout();
  const sides = tabInsets(layoutSize);
  // 平板上空状态、提示放在居中的内容栏里（≤ 640）
  const column: Insets | null = sides ? centerColumn(width, sides) : null;
  const stories = data?.stories;
  const header = <LargeHeader title="故事" count={stories ? stories.length : null} />;
  const swipeActions = (item: Playthrough) => [
    { key: "rename", label: "重命名", icon: "write" as const, onPress: () => void rename(item) },
    { key: "delete", label: "删除", icon: "trash" as const, danger: true, onPress: () => void remove(item) },
  ];

  if (!stories) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        <View style={column ? { paddingLeft: column.left, paddingRight: column.right } : null}>
          <Skeleton />
        </View>
        {!loading ? (
          <Notice
            icon="offline"
            message={
              error instanceof ApiError && error.isNetwork ? (
                <Text style={{ fontSize: 14, lineHeight: 20, color: palette.ink }}>
                  连不上服务器 <Text style={{ fontFamily: font.mono }}>{displayServer(serverUrl)}</Text>
                  ，列表没加载出来
                </Text>
              ) : (
                describeError(error)
              )
            }
            actionLabel="重新加载"
            onAction={() => void reload()}
            style={[styles.notice, column ? { marginLeft: column.left, marginRight: column.right } : null]}
          />
        ) : null}
      </View>
    );
  }
  if (sides && column) {
    const refresh_ = (
      <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.mut} />
    );
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {header}
        <ScrollView
          refreshControl={refresh_}
          contentContainerStyle={{
            paddingTop: space.s,
            paddingBottom: bottomSpace,
            paddingLeft: sides.left,
            paddingRight: sides.right,
          }}
        >
          {error ? (
            <View style={{ marginLeft: column.left - sides.left, marginRight: column.right - sides.right }}>
              <Notice
                icon="offline"
                message={describeError(error)}
                actionLabel="重试"
                onAction={() => void reload()}
                style={{ marginBottom: space.m }}
              />
            </View>
          ) : null}
          {stories.length === 0 ? (
            <View style={{ marginLeft: column.left - sides.left, marginRight: column.right - sides.right }}>
              <Empty onImport={() => router.navigate("/library")} />
            </View>
          ) : (
            <StoryGrid
              stories={stories}
              avatars={data.avatars}
              size={layoutSize}
              contentWidth={width - sides.left - sides.right}
              onOpen={(item) => router.push({ pathname: "/play/[id]", params: { id: item.id } })}
              onMenu={(item, anchor, hero) => void menu(item, anchor, hero)}
              swipeActions={swipeActions}
            />
          )}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {header}
      <FlatList
        data={stories}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[styles.list, { paddingBottom: bottomSpace }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.mut} />
        }
        ListHeaderComponent={
          error ? (
            <Notice
              icon="offline"
              message={describeError(error)}
              actionLabel="重试"
              onAction={() => void reload()}
              style={{ marginBottom: space.s }}
            />
          ) : null
        }
        ListEmptyComponent={<Empty onImport={() => router.navigate("/library")} />}
        ItemSeparatorComponent={() => <View style={{ height: space.s }} />}
        renderItem={({ item }) => (
          <SwipeRow actions={swipeActions(item)}>
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
  list: { paddingHorizontal: space.list, paddingTop: space.s },
  row: { flexDirection: "row", gap: 14, padding: 14, borderRadius: radius.option },
  rowBody: { flex: 1, minWidth: 0, gap: 5 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  title: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: "700" },
  time: { fontFamily: font.mono, fontSize: 11.5 },
  excerpt: { fontSize: 14, lineHeight: 21 },
  empty: {
    marginTop: space.s,
    paddingTop: space.xl,
    paddingHorizontal: space.page,
    paddingBottom: space.page,
    borderRadius: radius.sheet,
    gap: space.l,
  },
  emptyTitle: { fontSize: 22, lineHeight: 30, fontWeight: "700" },
  emptyText: { fontSize: 15, lineHeight: 24 },
  notice: { marginHorizontal: space.l, marginTop: space.l, borderRadius: radius.option },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: gap.card },
});
