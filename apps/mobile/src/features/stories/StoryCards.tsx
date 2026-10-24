/**
 * 存档的卡片（漫画风，docs/design/comic/mobile/png/02、tablet/png/02）：手机列表的一行、平板网格的小卡、
 * 最近一个存档放大成的主卡。都是白底 2.5 墨线的格子（圆角 12），封面 2 墨线；按下换成灰底，主卡带墨色投影 6。
 * 每张卡的标题行是标题和右端的更新时间，状态标在标题下面，最新一段用宋体。
 *
 * - 手机的一行：左边 72 的方形封面，右边标题、状态标和两行摘要；
 * - 小卡：高 184，第一行左边 56 的方形封面，下面最新一段最多 4 行；
 * - 主卡：中屏占满一行、宽屏占两列高两行；方形封面撑满卡片的高度，右边标题 28、最新一段宋体 18/32。
 * 长按时卡片抬起、下方弹出菜单（overlay.tsx 的 CardMenu），抬起的那张就是 lifted 再画一遍的同一张卡。
 */

import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import type { Playthrough } from "@bettertavern/core/api/types";
import { storyStatus } from "@bettertavern/core/play/storyStatus";
import { formatRelative } from "@bettertavern/core/utils/format";

import { Cover } from "../../components/Cover.tsx";
import { Pill, press } from "../../components/ui.tsx";
import {
  comicDepth,
  comicRadius,
  comicStroke,
  font,
  serifFor,
  useComic,
} from "../../theme/index.ts";

/** 手机列表行的封面边长 */
export const ROW_COVER = 72;
/** 小卡的高度；主卡高两格加中间的间距 */
export const STORY_CARD_HEIGHT = 184;
/** 主卡的内边距；封面边长 = 主卡高 − 2 × 内边距 */
export const STORY_HERO_PADDING = 22;
export const STORY_HERO_RADIUS = comicRadius.frame;
const SMALL_COVER = 56;

/** 状态标：正在写（蓝底加点）、已完结（墨底加旗子）、开场还没有写好（白底琥珀框） */
export function StoryStatusPill({ story }: { story: Playthrough }) {
  const status = storyStatus(story);
  if (status?.kind === "writing") return <Pill tone="accSolid" dot label={status.label} />;
  if (status?.kind === "noOpening") return <Pill tone="warn" icon="untested" label={status.label} />;
  if (status?.kind === "ended") return <Pill tone="ink" icon="flag" label={status.label} />;
  return null;
}

/** 标题和右端的更新时间，下面是状态标 */
function TitleBlock({ story, size }: { story: Playthrough; size: "row" | "card" | "hero" }) {
  const c = useComic();
  return (
    <View style={styles.titleBlock}>
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={[size === "hero" ? styles.heroTitle : styles.title, { color: c.ink }]}>
          {story.title}
        </Text>
        <Text style={[styles.time, { color: c.mut }]}>{formatRelative(story.updated_at)}</Text>
      </View>
      <StoryStatusPill story={story} />
    </View>
  );
}

/** 卡片外壳：白底墨线的格子，按下换成灰底（主卡往投影方向挪）；ref 给长按菜单量位置 */
function Shell({
  ref,
  story,
  onOpen,
  onMenu,
  hot,
  style,
  children,
}: {
  ref?: Ref<View>;
  story: Playthrough;
  onOpen: () => void;
  onMenu: () => void;
  /** 主卡：墨色投影 6 */
  hot?: boolean;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const c = useComic();
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
        styles.frame,
        style,
        { borderColor: c.ink, backgroundColor: pressed && !hot ? c.grey : c.paper },
        hot ? press(pressed, comicDepth.dialog, c.ink) : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** 手机列表的一行 */
export function StoryRow({
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
  const c = useComic();
  return (
    <Shell story={story} onOpen={onOpen} onMenu={onMenu} style={styles.row}>
      <Cover seed={story.scenario_id ?? story.id} blobId={avatar} width={ROW_COVER} height={ROW_COVER} framed />
      <View style={styles.rowBody}>
        <TitleBlock story={story} size="row" />
        {story.head_excerpt ? (
          <Text
            numberOfLines={2}
            style={[styles.excerpt, { color: c.ink2, fontFamily: serifFor(story.language) }]}
          >
            {story.head_excerpt}
          </Text>
        ) : null}
      </View>
    </Shell>
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
  const c = useComic();
  return (
    <>
      <View style={styles.top}>
        <Cover
          seed={story.scenario_id ?? story.id}
          blobId={avatar}
          width={SMALL_COVER}
          height={SMALL_COVER}
          framed
        />
        <TitleBlock story={story} size="card" />
      </View>
      {story.head_excerpt ? (
        <Text
          numberOfLines={4}
          style={[styles.cardExcerpt, { color: c.ink2, fontFamily: serifFor(story.language) }]}
        >
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
    <Shell ref={ref} story={story} onOpen={onOpen} onMenu={onMenu} hot style={[styles.hero, { width, height }]}>
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
  const c = useComic();
  // 摘要的行数：封面高度减去标题块，按 32 的行高能放几行
  const lines = Math.max(2, Math.floor((coverSize - HERO_TITLE_BLOCK) / HERO_EXCERPT_LINE));
  return (
    <>
      <Cover
        seed={story.scenario_id ?? story.id}
        blobId={avatar}
        width={coverSize}
        height={coverSize}
        rounded={comicRadius.frame}
        framed
      />
      <View style={styles.heroBody}>
        <TitleBlock story={story} size="hero" />
        {story.head_excerpt ? (
          <Text
            numberOfLines={lines}
            style={[styles.heroExcerpt, { color: c.ink, fontFamily: serifFor(story.language) }]}
          >
            {story.head_excerpt}
          </Text>
        ) : null}
      </View>
    </>
  );
}

/** 长按菜单里抬起的卡片：内容和卡片一样 */
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
  const c = useComic();
  const frame = { borderColor: c.ink, backgroundColor: c.paper };
  return hero ? (
    <View style={[styles.frame, styles.hero, frame, { flex: 1 }]}>
      <StoryHeroBody story={story} avatar={avatar} coverSize={hero} />
    </View>
  ) : (
    <View style={[styles.frame, styles.card, frame, { flex: 1 }]}>
      <StoryCardBody story={story} avatar={avatar} />
    </View>
  );
}

/** 主卡标题块的高度（标题 36 + 间距 + 状态标 22）和摘要的行高 */
const HERO_TITLE_BLOCK = 72;
const HERO_EXCERPT_LINE = 32;

const styles = StyleSheet.create({
  frame: { borderWidth: comicStroke.frame, borderRadius: comicRadius.frame, overflow: "hidden" },
  row: { flexDirection: "row", gap: 14, padding: 12 },
  rowBody: { flex: 1, minWidth: 0, gap: 6, paddingTop: 1 },
  card: { padding: 14, gap: 10 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  titleBlock: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  title: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: "900", letterSpacing: -0.2 },
  time: { fontFamily: font.monoMedium, fontSize: 11.5, lineHeight: 16 },
  excerpt: { fontSize: 14, lineHeight: 22 },
  cardExcerpt: { fontSize: 14, lineHeight: 23 },
  hero: { flexDirection: "row", gap: 22, padding: STORY_HERO_PADDING, overflow: "visible" },
  heroBody: { flex: 1, minWidth: 0, gap: 14 },
  heroTitle: { flex: 1, fontSize: 28, lineHeight: 36, fontWeight: "900", letterSpacing: -0.5 },
  heroExcerpt: { fontSize: 18, lineHeight: HERO_EXCERPT_LINE },
});
