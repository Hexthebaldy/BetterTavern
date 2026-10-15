/**
 * 平板上的故事卡片（设计稿 T03、T04）：网格里的小卡，以及最近一个故事放大成的主卡。
 * 数据和手机上的列表项一样；手机仍用 app/(tabs)/playthroughs.tsx 里的单列卡片。
 *
 * - 小卡：高 184，左上 56 的封面，旁边是标题和时间，下面是“正在写”胶囊和最新一段的前两行；
 * - 主卡：中屏占满一行、宽屏占两列，高两行；封面 132–148，标题 26，状态胶囊，最新一段用宋体 18/32 最多 4 行，
 *   底部是“继续读”按钮。
 * 长按时卡片抬起、下方弹出菜单（overlay.tsx 的 CardMenu），抬起的那张就是 lifted 再画一遍的同一张卡。
 */

import type { ReactNode, Ref } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import type { Playthrough } from "@bettertavern/core/api/types";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Cover } from "../../components/Cover.tsx";
import { Icon, Pill } from "../../components/ui.tsx";
import { font, radius, size, space, usePalette } from "../../theme/index.ts";

/** 小卡的高度；主卡高两格加中间的间距 */
export const STORY_CARD_HEIGHT = 184;

function Status({ story }: { story: Playthrough }) {
  const writing = story.active_turn_id !== null;
  const opening = story.head_turn_id === null;
  if (writing) return <Pill tone="acc" dot label={opening ? "正在写开场" : "正在写下一段"} />;
  if (opening && !story.head_excerpt) return <Pill tone="warn" icon="untested" label="开场还没有写好" />;
  return null;
}

/** 卡片外壳：灰卡、按下缩小；ref 给长按菜单量位置 */
function Shell({
  ref,
  story,
  onOpen,
  onMenu,
  style,
  children,
}: {
  ref?: Ref<View>;
  story: Playthrough;
  onOpen: () => void;
  onMenu: () => void;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={story.title}
      accessibilityHint="打开故事；长按可以重命名或删除"
      onPress={onOpen}
      onLongPress={onMenu}
      style={({ pressed }) => [
        style,
        { backgroundColor: pressed ? palette.bg3 : palette.bg2, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** 网格里的小卡 */
export function StoryCard({
  ref,
  story,
  avatar,
  width,
  onOpen,
  onMenu,
}: {
  ref?: Ref<View>;
  story: Playthrough;
  avatar: string | null;
  width: number;
  onOpen: () => void;
  onMenu: () => void;
}) {
  return (
    <Shell
      ref={ref}
      story={story}
      onOpen={onOpen}
      onMenu={onMenu}
      style={[styles.card, { width, height: STORY_CARD_HEIGHT }]}
    >
      <StoryCardBody story={story} avatar={avatar} />
    </Shell>
  );
}

/** 小卡里面的内容：长按菜单抬起的卡片也画这个 */
export function StoryCardBody({ story, avatar }: { story: Playthrough; avatar: string | null }) {
  const palette = usePalette();
  return (
    <>
      <View style={styles.top}>
        <Cover
          seed={story.scenario_id ?? story.id}
          blobId={avatar}
          width={size.cover}
          height={size.cover}
          surface="card"
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>
            {story.title}
          </Text>
          <Text style={[styles.time, { color: palette.mut }]}>{formatRelative(story.updated_at)}</Text>
        </View>
      </View>
      <Status story={story} />
      {story.head_excerpt ? (
        <Text numberOfLines={2} style={[styles.excerpt, { color: palette.ink2 }]}>
          {story.head_excerpt}
        </Text>
      ) : null}
    </>
  );
}

/** 最近一个故事放大成的主卡 */
export function StoryHero({
  ref,
  story,
  avatar,
  width,
  height,
  coverSize,
  onOpen,
  onMenu,
}: {
  ref?: Ref<View>;
  story: Playthrough;
  avatar: string | null;
  width: number;
  height: number;
  /** 封面边长：宽屏 148，中屏 132 */
  coverSize: number;
  onOpen: () => void;
  onMenu: () => void;
}) {
  return (
    <Shell ref={ref} story={story} onOpen={onOpen} onMenu={onMenu} style={[styles.hero, { width, height }]}>
      <StoryHeroBody story={story} avatar={avatar} coverSize={coverSize} />
    </Shell>
  );
}

/** 主卡里面的内容：长按菜单抬起的卡片也画这个 */
export function StoryHeroBody({
  story,
  avatar,
  coverSize,
}: {
  story: Playthrough;
  avatar: string | null;
  coverSize: number;
}) {
  const palette = usePalette();
  return (
    <>
      <Cover
        seed={story.scenario_id ?? story.id}
        blobId={avatar}
        width={coverSize}
        height={coverSize}
        surface="card"
        rounded={radius.option}
      />
      <View style={styles.heroBody}>
        <View style={styles.heroTitleRow}>
          <Text numberOfLines={1} style={[styles.heroTitle, { color: palette.ink }]}>
            {story.title}
          </Text>
          <Text style={[styles.time, { color: palette.mut }]}>{formatRelative(story.updated_at)}</Text>
        </View>
        <Status story={story} />
        {story.head_excerpt ? (
          <Text numberOfLines={4} style={[styles.heroExcerpt, { color: palette.narr }]}>
            {story.head_excerpt}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {/* 整张卡都能点，这里只是看起来像按钮 */}
        <View style={[styles.go, { backgroundColor: palette.pri }]} importantForAccessibility="no">
          <Text style={{ fontSize: 15, fontWeight: "500", color: palette.onPri }}>继续读</Text>
          <View style={[styles.goArrow, { backgroundColor: palette.arrowBg }]}>
            <Icon name="arrowRight" size={18} color={palette.onPri} />
          </View>
        </View>
      </View>
    </>
  );
}

/** 长按菜单里抬起的卡片：内容和卡片一样，底色由菜单画成白色 */
export function LiftedStory({
  story,
  avatar,
  hero,
}: {
  story: Playthrough;
  avatar: string | null;
  /** 主卡的封面边长；小卡不传 */
  hero?: number;
}) {
  return hero ? (
    <View style={[styles.hero, { flex: 1 }]}>
      <StoryHeroBody story={story} avatar={avatar} coverSize={hero} />
    </View>
  ) : (
    <View style={[styles.card, { flex: 1 }]}>
      <StoryCardBody story={story} avatar={avatar} />
    </View>
  );
}

export const STORY_HERO_RADIUS = radius.group;

const styles = StyleSheet.create({
  card: { padding: space.l, borderRadius: radius.option, gap: 10, overflow: "hidden" },
  top: { flexDirection: "row", alignItems: "center", gap: 14 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  time: { fontFamily: font.mono, fontSize: 11.5 },
  excerpt: { fontSize: 14, lineHeight: 21 },
  hero: { flexDirection: "row", gap: space.page, padding: space.page, borderRadius: radius.group },
  heroBody: { flex: 1, minWidth: 0, gap: space.m },
  heroTitleRow: { flexDirection: "row", alignItems: "baseline", gap: space.m },
  heroTitle: { flexShrink: 1, fontSize: 26, lineHeight: 34, fontWeight: "700", letterSpacing: -0.26 },
  heroExcerpt: { marginTop: space.xs, fontFamily: font.serif, fontSize: 18, lineHeight: 32 },
  go: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    paddingLeft: 20,
    paddingRight: 6,
    borderRadius: 24,
  },
  goArrow: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
