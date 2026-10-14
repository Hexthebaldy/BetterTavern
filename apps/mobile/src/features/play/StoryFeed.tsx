/**
 * 故事流：已完成的回合（memo 固定，不随流式文字重渲染）加上正在生成的那一段。
 *
 * 停在底部时自动跟随新文字；玩家往上翻时暂停跟随，出现“回到最新”。
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
} from "react-native";

import { space, type, usePalette } from "../../theme/index.ts";
import type { PendingTurn, Phase, PlayState, StoryTurn } from "./turnMachine.ts";

type Item = { key: string; turn: StoryTurn } | { key: "pending"; pending: PendingTurn };

const FOLLOW_THRESHOLD = 80;

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** 玩家的行动：左侧一道青色竖线，与选项按钮同一个记号 */
export function ActionNote({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.note, { borderLeftColor: palette.accent }]}>
      <Text style={[type.action, { color: palette.accent }]} selectable>
        {text}
      </Text>
    </View>
  );
}

function Narrative({ text, dim, caret }: { text: string; dim?: boolean; caret?: boolean }) {
  const palette = usePalette();
  const parts = paragraphs(text);
  const color = dim ? palette.muted : palette.ink;
  if (parts.length === 0) {
    return caret ? <Text style={[type.narrative, { color: palette.muted }]}>▍</Text> : null;
  }
  return (
    <View>
      {parts.map((p, i) => (
        <Text key={i} style={[type.narrative, styles.paragraph, { color }]} selectable>
          {p}
          {caret && i === parts.length - 1 ? <Text style={{ color: palette.muted }}>▍</Text> : null}
        </Text>
      ))}
    </View>
  );
}

const TurnBlock = memo(function TurnBlock({ turn }: { turn: StoryTurn }) {
  const showAction = turn.action.source !== "opening" && turn.action.text.length > 0;
  return (
    <View style={styles.turn}>
      {showAction ? <ActionNote text={turn.action.text} /> : null}
      <Narrative text={turn.narrative} />
    </View>
  );
});

function statusLine(pending: PendingTurn, phase: Phase): string | null {
  if (phase === "reconnecting") return "连接断了，正在重连…";
  if (phase === "polling") return "网络不太稳定，正在等待结果…";
  if (phase === "submitting") return "正在发送…";
  if (pending.buildingWorld) return "正在根据角色卡搭建世界…";
  if (pending.waitingState) return "世界还在更新…";
  if (phase === "streaming" && pending.narrative === "") return "正在构思…";
  return null;
}

function PendingBlock({ pending, phase }: { pending: PendingTurn; phase: Phase }) {
  const palette = usePalette();
  const failed = phase === "failed";
  const live = !failed;
  const status = live ? statusLine(pending, phase) : null;
  const showAction = pending.action && pending.action.source !== "opening" && pending.action.text.length > 0;
  return (
    <View style={styles.turn}>
      {showAction && pending.action ? <ActionNote text={pending.action.text} /> : null}
      {status ? (
        <Text
          style={[type.caption, styles.status, { color: palette.muted }]}
          accessibilityLiveRegion="polite"
        >
          {status}
        </Text>
      ) : null}
      <Narrative text={pending.narrative} dim={failed} caret={live && phase !== "submitting"} />
    </View>
  );
}

export function StoryFeed({ state, header }: { state: PlayState; header?: ReactElement }) {
  const palette = usePalette();
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);

  const items = useMemo(() => {
    const result: Item[] = state.turns.map((turn) => ({ key: turn.id, turn }));
    if (state.pending) result.push({ key: "pending", pending: state.pending });
    return result;
  }, [state.turns, state.pending]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const atBottom = distance < FOLLOW_THRESHOLD;
    following.current = atBottom;
    setShowLatest((shown) => (shown === !atBottom ? shown : !atBottom));
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (following.current) list.current?.scrollToEnd({ animated: false });
  }, []);

  const jumpToLatest = useCallback(() => {
    following.current = true;
    setShowLatest(false);
    list.current?.scrollToEnd({ animated: true });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      "turn" in item ? (
        <TurnBlock turn={item.turn} />
      ) : (
        <PendingBlock pending={item.pending} phase={state.phase} />
      ),
    [state.phase],
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={onContentSizeChange}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={9}
      />
      {showLatest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="回到最新"
          onPress={jumpToLatest}
          style={[styles.latest, { backgroundColor: palette.surface, borderColor: palette.rule }]}
        >
          <Text style={[type.caption, { color: palette.accent, fontWeight: "600" }]}>回到最新</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl - 2, paddingTop: space.l, paddingBottom: space.xl },
  turn: { marginBottom: space.l },
  paragraph: { marginBottom: space.m },
  note: { borderLeftWidth: 2, paddingLeft: space.m, marginBottom: space.l, marginTop: space.xs },
  status: { marginBottom: space.s },
  latest: {
    position: "absolute",
    right: space.l,
    bottom: space.m,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
});
