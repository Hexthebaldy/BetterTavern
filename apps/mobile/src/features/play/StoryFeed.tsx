/**
 * 故事流：书名页、已完成的回合（memo 固定，不随流式文字重渲染）加上正在生成的那一段。
 *
 * “我的行动”是一条通栏浅灰色带，前面一个蓝色转折箭头，同时充当回合之间的分隔。叙述用宋体（阅读设置里可换黑体），
 * 左右页边距 24，段落之间空 16，两端对齐。流式光标是 2px 宽的蓝色竖条，不闪烁。
 *
 * 停在底部时自动跟随新文字；玩家往上翻时暂停跟随，离开底部超过 80pt 浮出“回到最新”。
 * 只有玩家亲手拖动或惯性滚动才会关掉跟随：内容变长时程序滚动产生的事件里，偏移量常常落后于新的内容高度，
 * 不能当成玩家翻走了。
 */

import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from "react-native";

import { Cover } from "../../components/Cover.tsx";
import { Dots, Icon } from "../../components/ui.tsx";
import { font, space, usePalette } from "../../theme/index.ts";
import { BASE_SIZE, lineHeightFor, MAX_SIZE, readingSize, type ReadingPrefs } from "./reading.ts";
import type { PendingTurn, Phase, PlayState, StoryTurn } from "./turnMachine.ts";

type Item = { key: string; turn: StoryTurn } | { key: "pending"; pending: PendingTurn };

const FOLLOW_THRESHOLD = 80;

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** 叙述正文的字体和字号：没设置字号时跟随系统的动态字体，放大到 24 为止 */
export function useNarrativeStyle(prefs: ReadingPrefs): {
  style: TextStyle;
  scale: boolean;
  maxScale: number;
} {
  const palette = usePalette();
  return useMemo(() => {
    const size = readingSize(prefs);
    return {
      style: {
        fontFamily: prefs.font === "serif" ? font.serif : undefined,
        fontSize: size,
        lineHeight: lineHeightFor(size),
        letterSpacing: size * 0.01,
        color: palette.narr,
        textAlign: "justify",
      },
      scale: prefs.size === null,
      maxScale: MAX_SIZE / BASE_SIZE,
    };
  }, [prefs, palette]);
}

type Narr = ReturnType<typeof useNarrativeStyle>;

/** 书名页：往上翻到顶看到的第一屏 */
export function BookHeader({
  seed,
  blobId,
  title,
  card,
  protagonist,
  width,
}: {
  seed: string;
  blobId: string | null;
  title: string;
  card: string | null;
  protagonist: string;
  width: number;
}) {
  const palette = usePalette();
  const meta = [card, protagonist ? `我是 ${protagonist}` : null].filter(Boolean).join(" · ");
  return (
    <View style={[styles.book, { borderBottomColor: palette.line }]}>
      <Cover seed={seed} blobId={blobId} width={width - space.read * 2} height={120} />
      <Text style={[styles.bookTitle, { color: palette.ink }]}>{title}</Text>
      {meta ? <Text style={[styles.mono, { color: palette.mut }]}>{meta}</Text> : null}
    </View>
  );
}

/** “我的行动”色带；读屏时前面加上“我的行动：” */
export function ActionNote({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <View
      accessible
      accessibilityLabel={`我的行动：${text}`}
      style={[styles.note, { backgroundColor: palette.bg2, borderColor: palette.line }]}
    >
      <View style={{ marginTop: 2 }}>
        <Icon name="turn" size={20} color={palette.acc} />
      </View>
      <Text style={[styles.noteText, { color: palette.ink }]} selectable>
        {text}
      </Text>
    </View>
  );
}

function Caret({ color, height }: { color: string; height: number }) {
  return <View style={{ width: 2, height, marginLeft: 3, backgroundColor: color }} />;
}

function Narrative({
  text,
  narr,
  dim,
  caret,
  interrupted,
}: {
  text: string;
  narr: Narr;
  dim?: boolean;
  /** 光标颜色；不传就不画光标 */
  caret?: string;
  interrupted?: boolean;
}) {
  const palette = usePalette();
  const parts = paragraphs(text);
  const caretHeight = Math.round((narr.style.fontSize ?? 17.5) * 1.15);
  if (parts.length === 0) {
    return caret ? (
      <View style={[styles.caretOnly, { height: narr.style.lineHeight }]}>
        <Caret color={caret} height={caretHeight} />
      </View>
    ) : null;
  }
  return (
    <View>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        return (
          <Text
            key={i}
            selectable
            allowFontScaling={narr.scale}
            maxFontSizeMultiplier={narr.maxScale}
            style={[
              narr.style,
              styles.paragraph,
              last ? { marginBottom: 0 } : null,
              dim ? { color: palette.mut } : null,
            ]}
          >
            {p}
            {last && caret ? <Caret color={caret} height={caretHeight} /> : null}
            {last && interrupted ? (
              <View style={[styles.cutBox, { borderColor: palette.line2 }]}>
                <Text style={[styles.cut, { color: palette.mut }]}>中断</Text>
              </View>
            ) : null}
          </Text>
        );
      })}
    </View>
  );
}

const TurnBlock = memo(function TurnBlock({ turn, narr }: { turn: StoryTurn; narr: Narr }) {
  const showAction = turn.action.source !== "opening" && turn.action.text.length > 0;
  return (
    <View style={styles.turn}>
      {showAction ? <ActionNote text={turn.action.text} /> : null}
      <Narrative text={turn.narrative} narr={narr} />
    </View>
  );
});

/** 正文上方的一行状态（等宽小字） */
function StatusLine({ pending, phase }: { pending: PendingTurn; phase: Phase }) {
  const palette = usePalette();
  let icon: ReactElement | null = <Dots color={palette.acc} cell={5} gap={3} />;
  let text: string | null = null;
  let note: string | null = null;
  let color = palette.mut;
  if (phase === "reconnecting") {
    icon = <Icon name="retry" size={15} color={palette.warn} />;
    text = "连接断了，正在重连…";
    note = "已写好的不会丢";
    color = palette.warn;
  } else if (phase === "polling") {
    icon = <Icon name="retry" size={15} color={palette.warn} />;
    text = "网络不太稳定，正在等待结果…";
    color = palette.warn;
  } else if (phase === "submitting") {
    text = "正在发送…";
  } else if (pending.waitingState) {
    text = "世界还在更新…";
  } else if (phase === "streaming" && pending.narrative === "") {
    text = "正在构思…";
  }
  if (!text) return null;
  return (
    <View style={styles.status} accessibilityLiveRegion="polite">
      {icon}
      <Text style={[styles.mono, { color }]}>{text}</Text>
      {note ? <Text style={[styles.mono, { color: palette.mut }]}>{note}</Text> : null}
    </View>
  );
}

/** 第一次开场：先搭建世界，再写开场 */
function OpeningSteps({ building }: { building: boolean }) {
  const palette = usePalette();
  const step = (label: string, state: "active" | "done" | "todo") => (
    <View style={styles.stepRow}>
      <View style={styles.stepMark}>
        {state === "active" ? (
          <View style={{ width: 8, height: 8, backgroundColor: palette.acc }} />
        ) : state === "done" ? (
          <Icon name="check" size={16} color={palette.ok} strokeWidth={2} />
        ) : (
          <View style={{ width: 18, height: 18, borderWidth: 1.5, borderColor: palette.line2 }} />
        )}
      </View>
      <Text style={[styles.mono, { fontSize: 12, color: state === "active" ? palette.acc : palette.mut }]}>
        {label}
      </Text>
    </View>
  );
  return (
    <View style={styles.steps} accessibilityLiveRegion="polite">
      {step(building ? "正在根据角色卡搭建世界…" : "搭建世界", building ? "active" : "done")}
      {step(building ? "写开场" : "正在写开场…", building ? "todo" : "active")}
      <Text style={[styles.stepNote, { color: palette.mut, borderTopColor: palette.line }]}>
        第一次开场比较慢。可以先离开，写好后会出现在“故事”里。
      </Text>
    </View>
  );
}

function PendingBlock({ pending, phase, narr }: { pending: PendingTurn; phase: Phase; narr: Narr }) {
  const palette = usePalette();
  const failed = phase === "failed";
  const opening = pending.action?.source === "opening";
  const showAction = pending.action && !opening && pending.action.text.length > 0;
  const caret =
    failed || phase === "submitting"
      ? undefined
      : phase === "reconnecting" || phase === "polling"
        ? palette.line2
        : palette.acc;
  if (opening && !failed && pending.narrative === "") {
    return <OpeningSteps building={pending.buildingWorld} />;
  }
  return (
    <View style={styles.turn}>
      {showAction && pending.action ? <ActionNote text={pending.action.text} /> : null}
      {failed ? null : <StatusLine pending={pending} phase={phase} />}
      <Narrative
        text={pending.narrative}
        narr={narr}
        dim={failed}
        caret={caret}
        interrupted={failed && pending.narrative.length > 0}
      />
    </View>
  );
}

/** 开场还没写（上次中断了） */
function OpeningMissing() {
  const palette = usePalette();
  return (
    <View style={styles.missing}>
      <View style={{ marginTop: 2 }}>
        <Icon name="untested" size={20} color={palette.warn} />
      </View>
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 24, color: palette.ink2 }}>
        开场还没有写好，上次可能中断了。
      </Text>
    </View>
  );
}

export function StoryFeed({
  state,
  header,
  reading,
  dimmed,
}: {
  state: PlayState;
  header?: ReactElement;
  reading: ReadingPrefs;
  /** 同步中：内容变淡 */
  dimmed?: boolean;
}) {
  const palette = usePalette();
  const narr = useNarrativeStyle(reading);
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const byUser = useRef(false); // 玩家正在拖动，或者拖动之后的惯性滚动
  const [showLatest, setShowLatest] = useState(false);

  const items = useMemo(() => {
    const result: Item[] = state.turns.map((turn) => ({ key: turn.id, turn }));
    if (state.pending) result.push({ key: "pending", pending: state.pending });
    return result;
  }, [state.turns, state.pending]);

  const track = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const atBottom = distance < FOLLOW_THRESHOLD;
    if (!atBottom && !byUser.current) return;
    following.current = atBottom;
    setShowLatest((shown) => (shown === !atBottom ? shown : !atBottom));
  }, []);

  const onDragStart = useCallback(() => {
    byUser.current = true;
  }, []);

  const onUserScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      track(e);
      byUser.current = false;
    },
    [track],
  );

  // 推到下一帧：首次布局时在 onContentSizeChange 里直接调用会被忽略（iOS 上实测），打开故事就停在开头
  const stickToEnd = useCallback(() => {
    if (!following.current) return;
    requestAnimationFrame(() => {
      if (following.current) list.current?.scrollToEnd({ animated: false });
    });
  }, []);

  const jumpToLatest = useCallback(() => {
    following.current = true;
    setShowLatest(false);
    list.current?.scrollToEnd({ animated: true });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      "turn" in item ? (
        <TurnBlock turn={item.turn} narr={narr} />
      ) : (
        <PendingBlock pending={item.pending} phase={state.phase} narr={narr} />
      ),
    [state.phase, narr],
  );

  const missingOpening = state.turns.length === 0 && state.phase === "idle";
  const live = state.pending !== null && state.phase !== "failed";
  return (
    <View style={{ flex: 1, opacity: dimmed ? 0.4 : 1 }}>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={missingOpening ? <OpeningMissing /> : null}
        contentContainerStyle={styles.content}
        onScroll={track}
        onScrollBeginDrag={onDragStart}
        onScrollEndDrag={onUserScrollEnd}
        onMomentumScrollBegin={onDragStart}
        onMomentumScrollEnd={onUserScrollEnd}
        scrollEventThrottle={64}
        onContentSizeChange={stickToEnd}
        onLayout={stickToEnd}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={9}
      />
      {showLatest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={live ? "回到最新，有新内容" : "回到最新"}
          onPress={jumpToLatest}
          style={[styles.latest, { backgroundColor: palette.ink }]}
        >
          <Icon name="down" size={18} color={palette.bg} />
          <Text style={{ fontSize: 14, fontWeight: "500", color: palette.bg }}>回到最新</Text>
          {live ? <View style={styles.latestDot} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.page },
  book: {
    padding: space.read,
    paddingBottom: space.xl,
    gap: 14,
    borderBottomWidth: 1,
    marginBottom: space.read,
  },
  bookTitle: { fontSize: 30, lineHeight: 36, fontWeight: "900", letterSpacing: -0.9 },
  mono: { fontFamily: font.mono, fontSize: 11.5, lineHeight: 16, letterSpacing: 0.7 },
  turn: { marginBottom: space.l },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.m,
    marginTop: space.m,
    marginBottom: 22,
    paddingVertical: 14,
    paddingHorizontal: space.read,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  noteText: { flex: 1, fontSize: 15, lineHeight: 24, fontWeight: "500" },
  paragraph: { marginBottom: space.l, paddingHorizontal: space.read },
  caretOnly: { paddingHorizontal: space.read - 3, justifyContent: "center" },
  cutBox: { marginLeft: space.s, paddingHorizontal: 6, borderWidth: 1 },
  cut: { fontFamily: font.mono, fontSize: 11, lineHeight: 18, letterSpacing: 0.7 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingHorizontal: space.read,
    marginBottom: 10,
  },
  steps: { paddingHorizontal: space.read, paddingTop: space.s, gap: 14 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepMark: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  stepNote: { fontSize: 13, lineHeight: 20, paddingTop: space.m, borderTopWidth: 1 },
  missing: { flexDirection: "row", gap: space.m, paddingHorizontal: space.read, paddingTop: space.s },
  latest: {
    position: "absolute",
    alignSelf: "center",
    bottom: space.page,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 44,
    paddingLeft: space.m,
    paddingRight: space.l,
    shadowColor: "#111111",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  latestDot: { width: 6, height: 6, backgroundColor: "#7C8CFF" },
});
