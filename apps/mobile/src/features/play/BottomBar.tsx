/**
 * 阅读页底部固定的操作栏：左边“世界”，右边“更多”，中间一格按状态换内容。选项不在这里，接在正文末尾（TurnActions.tsx）。
 *
 * 中间那一格：
 * - 空闲：“自己写…”（有草稿时显示草稿），点一下原地展开成输入框，跟着键盘浮起；发送或收起后缩回来；
 * - 生成中：状态（正在发送 / 正在构思 / 正在回想前情 / 世界还在更新 / 正在写下一段 / 正在写结局）和“停止”；重连、等结果时是琥珀色。
 *   这些状态只在这里显示，正文里不重复；
 * - 同步中：锁和“同步完成前暂时不能行动”；还没开场时空着（“开始故事”在正文末尾）；
 * - 写完结局：旗子和灰字“故事已完结”，不能再写。
 * 往上翻离开了最新位置（超过 80pt）时，中间这一格的右端滑出一个下箭头图标按钮（和世界、更多一样），“自己写…”跟着变窄；
 * 点它回到最新，生成中带一个蓝点表示有新内容。
 *
 * 漫画风（docs/design/comic/mobile/README.md 的“阅读页”）：页面底色，顶上一道 2.5 墨线；世界、更多是 44 的图标按钮；
 * “自己写…”是 2 的墨色虚线胶囊；生成中是灰底墨框的胶囊，里面蓝点、状态和墨底的“停止”。
 * 贴着屏幕底边，Home 指示条算在底边距里；键盘弹出时贴着键盘。
 * 平板上内容宽 672（theme/layout.ts 的 actionPanelFrame），和正文同一条中线；底色仍铺满阅读区。
 * 盖住的高度经 onHeight 报给页面，故事流的底部跟着留白。
 */

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { actionPanelFrame } from "@bettertavern/design/layout";
import {
  canAct,
  isEnded,
  isLive,
  needsOpening,
  speakerOf,
  type PlayState,
} from "@bettertavern/core/play/turnMachine";

import { Icon, IconButton, type IconName } from "../../components/ui.tsx";
import { useKeyboardLift } from "../../hooks/useKeyboardLift.ts";
import { comicStroke, space, useComic } from "../../theme/index.ts";
import { FreeInput } from "./ActionParts.tsx";
import type { PlayControls } from "./usePlaySession.ts";

type Props = {
  state: PlayState;
  controls: PlayControls;
  /** 输入框展开着 */
  writing: boolean;
  onWrite: () => void;
  onCloseWrite: () => void;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => void;
  /** 离开了最新位置 */
  away: boolean;
  onJumpToLatest: () => void;
  /** 不传时不显示世界按钮（闪电模式没有世界状态），原处留一个同样大小的空位，中间不跑偏 */
  onOpenWorld?: () => void;
  onOpenMore: () => void;
  /** 世界状态停靠着（平板宽屏）：世界按钮显示为选中，再点一次收起 */
  worldActive?: boolean;
  /** “更多”菜单开着：更多按钮显示为选中 */
  moreActive?: boolean;
  /** “更多”按钮：平板上菜单贴着它弹出 */
  moreRef?: Ref<View>;
  /** 盖住的高度（操作栏加上 iOS 键盘） */
  onHeight: (height: number) => void;
  /** 阅读区的宽度（世界状态停靠时比窗口窄），内容在里面居中 */
  available: number;
};

export function BottomBar({
  state,
  controls,
  writing,
  onWrite,
  onCloseWrite,
  draft,
  onDraft,
  onSend,
  away,
  onJumpToLatest,
  onOpenWorld,
  onOpenMore,
  worldActive,
  moreActive,
  moreRef,
  onHeight,
  available,
}: Props) {
  const c = useComic();
  const insets = useSafeAreaInsets();
  const { height: keyboardHeight, lift } = useKeyboardLift();
  const keyboard = keyboardHeight > 0;
  const [barHeight, setBarHeight] = useState(0);
  const frame = actionPanelFrame(available);
  const { t } = useTranslation();

  useEffect(() => {
    if (barHeight > 0) onHeight(barHeight + keyboardHeight);
  }, [barHeight, keyboardHeight, onHeight]);

  if (state.phase === "loading" || state.phase === "load_failed") return null;

  const enabled = canAct(state);
  const live = isLive(state);
  const cancellable = live && state.pending?.turnId != null && state.phase !== "submitting";
  const stop = cancellable ? <StopButton onPress={controls.cancel} /> : null;

  let middle;
  if (live) {
    middle = <LiveStatus state={state} stop={stop} />;
  } else if (state.phase === "syncing") {
    middle = (
      <View style={styles.note}>
        <Icon name="lock" size={18} color={c.mut} />
        <Text numberOfLines={1} style={[styles.noteText, { color: c.mut }]}>
          {t("play.syncBlocked")}
        </Text>
      </View>
    );
  } else if (isEnded(state)) {
    middle = (
      <View style={styles.note}>
        <Icon name="flag" size={18} color={c.mut} />
        <Text numberOfLines={1} style={[styles.noteText, { color: c.mut }]}>
          {t("play.ended")}
        </Text>
      </View>
    );
  } else if (needsOpening(state) || state.turns.length === 0) {
    middle = <View style={{ flex: 1 }} />;
  } else {
    middle = <WriteButton draft={draft} enabled={enabled} onPress={onWrite} />;
  }

  const expanded = writing && enabled;
  return (
    <Animated.View
      accessibilityRole="toolbar"
      onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
      style={[
        styles.bar,
        {
          bottom: lift,
          backgroundColor: c.page,
          borderTopColor: c.ink,
          // Home 指示条压在底边距里，内容停在它上方；键盘弹出时贴着键盘
          paddingBottom: keyboard ? 9 : Math.max(insets.bottom - space.s, 9),
        },
      ]}
    >
      <View style={[styles.inner, { width: frame.width }]}>
        {expanded ? (
          <FreeInput
            draft={draft}
            onDraft={onDraft}
            disabled={!enabled}
            onSend={onSend}
            onClose={onCloseWrite}
            language={state.language}
          />
        ) : (
          <View style={styles.row}>
            {onOpenWorld ? (
              <ToolButton
                icon="world"
                label={worldActive ? t("play.worldHide") : t("play.world")}
                active={worldActive}
                onPress={onOpenWorld}
              />
            ) : (
              <View style={{ width: 44, height: 44 }} />
            )}
            <View style={styles.middle}>
              {middle}
              <JumpButton shown={away} live={live} onPress={onJumpToLatest} />
            </View>
            <ToolButton
              ref={moreRef}
              icon="more"
              label={t("play.moreLabel")}
              active={moreActive}
              onPress={onOpenMore}
            />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

/** 世界、更多两个 44 的图标按钮；选中时墨底、蓝投影 */
function ToolButton({
  ref,
  icon,
  label,
  active,
  onPress,
}: {
  ref?: Ref<View>;
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return <IconButton ref={ref} icon={icon} label={label} diameter={44} active={active} onPress={onPress} />;
}

/** “自己写…”：墨色虚线胶囊，有草稿时显示草稿 */
function WriteButton({ draft, enabled, onPress }: { draft: string; enabled: boolean; onPress: () => void }) {
  const c = useComic();
  const { t } = useTranslation();
  const line = enabled ? c.ink : c.disabledLine;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={draft ? t("play.continueDraft") : t("play.writeOwn")}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: line, backgroundColor: pressed ? c.grey : "transparent" },
      ]}
    >
      <Icon name="write" size={16} color={enabled ? c.mut : c.disabledLine} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontSize: 15, color: !enabled ? c.disabledLine : draft ? c.ink : c.mut }}
      >
        {draft ? draft : t("play.writeOwnPlaceholder")}
      </Text>
    </Pressable>
  );
}

/** 生成中：灰底墨框的胶囊，蓝点加一句状态，右端是“停止”；重连、等结果时点和字是琥珀色 */
function LiveStatus({ state, stop }: { state: PlayState; stop: ReactNode }) {
  const c = useComic();
  const { t } = useTranslation();
  const warn = state.phase === "reconnecting" || state.phase === "polling";
  const source = state.pending?.action?.source;
  const pending = state.pending;
  // 多角色的局：正在写的那一段是谁
  const segment = pending?.segments.at(-1);
  const speaker = segment ? (speakerOf(state.cast, segment)?.name ?? t("play.narrator")) : null;
  const label =
    state.phase === "reconnecting"
      ? t("play.reconnecting")
      : state.phase === "polling"
        ? t("play.polling")
        : state.phase === "submitting"
          ? t("play.sending")
          : pending?.recalling
            ? t("play.recalling")
            : speaker !== null
              ? t("play.speaking", { name: speaker })
              : pending?.narrative === ""
                ? t("play.thinking")
                : source === "opening"
                  ? t("play.writingOpening")
                  : source === "ending"
                    ? t("play.writingEnding")
                    : t("play.writingNext");
  return (
    <View
      style={[styles.live, { borderColor: c.ink, backgroundColor: c.grey }]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.dot, { backgroundColor: warn ? c.warn : c.acc, borderColor: c.ink }]} />
      <Text numberOfLines={1} style={[styles.liveText, { color: warn ? c.warn : c.ink }]}>
        {label}
      </Text>
      {stop}
    </View>
  );
}

/** 圆按钮的直径；中间一格里各项之间空 8 */
const JUMP_SIZE = 44;
const MIDDLE_GAP = space.s;
/** 下箭头展开、收起（左边的输入框跟着变宽变窄）的时长 */
const JUMP_MS = 360;

/**
 * 回到最新：下箭头图标按钮，和世界、更多一样，生成中带一个蓝点。一直挂着，离开最新位置时从宽 0 展开（左边的“自己写…”跟着变窄），
 * 回到底部时收起；收起时不占位置，也不给读屏。
 */
function JumpButton({ shown, live, onPress }: { shown: boolean; live: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const progress = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    // 宽度要进布局（左边的输入框跟着变窄），不能用原生驱动
    Animated.timing(progress, {
      toValue: shown ? 1 : 0,
      duration: JUMP_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [shown, progress]);
  return (
    <Animated.View
      pointerEvents={shown ? "auto" : "none"}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      style={[
        styles.jump,
        {
          width: progress.interpolate({ inputRange: [0, 1], outputRange: [0, JUMP_SIZE] }),
          // 收起时抵掉前面那 8 的间距
          marginLeft: progress.interpolate({ inputRange: [0, 1], outputRange: [-MIDDLE_GAP, 0] }),
          opacity: progress,
        },
      ]}
    >
      <IconButton
        icon="down"
        label={live ? t("play.latestNew") : t("play.latest")}
        diameter={JUMP_SIZE}
        size={20}
        badge={live}
        onPress={onPress}
      />
    </Animated.View>
  );
}

/** 生成中胶囊里的“停止”：墨底白字的小胶囊 */
function StopButton({ onPress }: { onPress: () => void }) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.stop")}
      onPress={onPress}
      hitSlop={5}
      style={({ pressed }) => [styles.stop, { backgroundColor: pressed ? c.ink2 : c.ink }]}
    >
      <View style={[styles.stopMark, { backgroundColor: c.paper }]} />
      <Text style={[styles.stopText, { color: c.paper }]}>{t("common.stop")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingTop: 9,
    borderTopWidth: comicStroke.frame,
  },
  // 44 的图标按钮下面有 2 的投影：多留 2
  inner: { alignSelf: "center", paddingHorizontal: 6, paddingBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46 },
  middle: { flex: 1, flexDirection: "row", alignItems: "center", gap: MIDDLE_GAP },
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 44,
    paddingHorizontal: space.l,
    borderRadius: 22,
    borderWidth: comicStroke.control,
    borderStyle: "dashed",
  },
  jump: { height: JUMP_SIZE + 2, overflow: "hidden" },
  note: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.s },
  noteText: { flexShrink: 1, fontSize: 14.5, fontWeight: "600" },
  live: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    paddingLeft: space.l,
    paddingRight: 5,
    borderRadius: 22,
    borderWidth: comicStroke.control,
  },
  liveText: { flex: 1, fontSize: 14.5, fontWeight: "700" },
  dot: { width: 13, height: 13, borderRadius: 6.5, borderWidth: 2 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: space.m,
    borderRadius: 17,
  },
  stopMark: { width: 10, height: 10, borderRadius: 2 },
  stopText: { fontSize: 13.5, fontWeight: "700" },
});
