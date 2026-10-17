/**
 * 平板上的存档卡片（设计稿 T03、T04）：网格里的小卡，以及最近一个存档放大成的主卡。
 * 数据和手机上的列表项一样；手机仍用 app/(tabs)/playthroughs.tsx 里的单列卡片。
 * 两种卡片的第一行都是：标题、紧跟着的状态胶囊（已完结、正在写…），右端是更新时间。
 *
 * - 小卡：高 184，第一行左边是 56 的方形封面；下面是最新一段的开头，最多 4 行，正好填满卡片；
 * - 主卡：中屏占满一行、宽屏占两列，高两行；方形封面撑满卡片的高度（边长 = 卡片高 − 上下内边距），
 *   右边第一行标题 26，下面最新一段用宋体 18/32，行数按封面的高度算，和封面一样高。整张卡都能点，没有按钮。
 * 长按时卡片抬起、下方弹出菜单（overlay.tsx 的 CardMenu），抬起的那张就是 lifted 再画一遍的同一张卡。
 */

import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import type { Playthrough } from "@bettertavern/core/api/types";
import { storyStatus } from "@bettertavern/core/play/storyStatus";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Cover } from "../../components/Cover.tsx";
import { Pill } from "../../components/ui.tsx";
import { font, radius, size, space, usePalette } from "../../theme/index.ts";

/** 小卡的高度；主卡高两格加中间的间距 */
export const STORY_CARD_HEIGHT = 184;
/** 主卡的内边距；封面边长 = 主卡高 − 2 × 内边距 */
export const STORY_HERO_PADDING = space.page;

/** 状态胶囊，放在标题右边（Pill 默认贴着顶，这里在一行里居中） */
export function StoryStatusPill({ story }: { story: Playthrough }) {
  const status = storyStatus(story);
  if (status?.kind === "writing") return <Pill tone="acc" dot label={status.label} style={styles.pill} />;
  if (status?.kind === "noOpening")
    return <Pill tone="warn" icon="untested" label={status.label} style={styles.pill} />;
  if (status?.kind === "ended")
    return <Pill tone="card" icon="flag" label={status.label} style={styles.pill} />;
  return null;
}

/** 第一行：标题、状态胶囊，右端是更新时间 */
function TitleRow({ story, large }: { story: Playthrough; large?: boolean }) {
  const palette = usePalette();
  return (
    <View style={[styles.titleRow, large ? null : { flex: 1 }]}>
      <Text numberOfLines={1} style={[large ? styles.heroTitle : styles.title, { color: palette.ink }]}>
        {story.title}
      </Text>
      <StoryStatusPill story={story} />
      <View style={{ flex: 1 }} />
      <Text style={[styles.time, { color: palette.mut }]}>{formatRelative(story.updated_at)}</Text>
    </View>
  );
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
  const { t } = useTranslation();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={story.title}
      accessibilityHint={t("stories.cardHint")}
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
        <TitleRow story={story} />
      </View>
      {story.head_excerpt ? (
        <Text numberOfLines={4} style={[styles.excerpt, { color: palette.ink2 }]}>
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
  /** 封面边长：主卡高 − 2 × 内边距 */
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
  // 摘要的行数：封面高度减去标题行和间距，按 32 的行高能放几行
  const lines = Math.max(
    2,
    Math.floor((coverSize - HERO_TITLE_LINE - space.m - space.xs) / HERO_EXCERPT_LINE),
  );
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
        <TitleRow story={story} large />
        {story.head_excerpt ? (
          <Text numberOfLines={lines} style={[styles.heroExcerpt, { color: palette.narr }]}>
            {story.head_excerpt}
          </Text>
        ) : null}
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

const HERO_TITLE_LINE = 34;
const HERO_EXCERPT_LINE = 32;

const styles = StyleSheet.create({
  card: { padding: space.l, borderRadius: radius.option, gap: space.m, overflow: "hidden" },
  top: { flexDirection: "row", alignItems: "center", gap: 14 },
  titleRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.s },
  title: { flexShrink: 1, fontSize: 17, lineHeight: 24, fontWeight: "700" },
  pill: { alignSelf: "center", flexShrink: 0 },
  time: { fontFamily: font.mono, fontSize: 11.5 },
  excerpt: { fontSize: 14, lineHeight: 21 },
  hero: {
    flexDirection: "row",
    gap: space.page,
    padding: STORY_HERO_PADDING,
    borderRadius: radius.group,
  },
  heroBody: { flex: 1, minWidth: 0, gap: space.m },
  heroTitle: {
    flexShrink: 1,
    fontSize: 26,
    lineHeight: HERO_TITLE_LINE,
    fontWeight: "700",
    letterSpacing: -0.26,
  },
  heroExcerpt: {
    marginTop: space.xs,
    fontFamily: font.serif,
    fontSize: 18,
    lineHeight: HERO_EXCERPT_LINE,
  },
});
