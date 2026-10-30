/**
 * 故事流：书名页、已完成的回合（memo 固定，不随流式文字重渲染）、正在生成的那一段，最后是行动区
 * （选项、“自己写…”、生成中的状态，见 TurnActions.tsx），行动区跟着正文一起滚动。
 * 书名页、叙述、你的行动、开场的两步、结束标记这几块在 FeedParts.tsx（漫画风）。
 * 多角色的局（docs/cast.md）按 segments 一段一段排：角色那一段前面是头像和名字，旁白那一段和普通叙述一样（CastParts.tsx）。
 * 配图（docs/illustrations.md）：每回合正文下面是这一回合的图和靠右的“画这一幕”（PictureParts.tsx）。
 *
 * 底部固定着操作栏（BottomBar.tsx）：内容底部按 bottomInset 留白。正在发送、正在构思、重连这些状态也在操作栏里，正文这里不重复。
 * 停在底部时自动跟随新文字；玩家往上翻时暂停跟随，离开底部超过 80pt 时经 onAwayChange 告诉页面，
 * 操作栏中间换成“回到最新”（调用 ref 上的 jumpToLatest）。
 * 只有玩家亲手拖动或惯性滚动才会关掉跟随：内容变长时程序滚动产生的事件里，偏移量常常落后于新的内容高度，
 * 不能当成玩家翻走了。
 *
 * 平板上内容收进一条阅读栏（theme/layout.ts 的 readableColumn）：正文最宽 640、在阅读区里居中，
 * “我的行动”、状态行、书名页跟着这条栏走，左右边距和手机一样；字号仍由阅读设置决定，栏宽不随字号变。
 * 滚动区仍是整个阅读区，两边空白处也能拖动。
 */

import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactElement,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { FlatList, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import type { CastMember, TurnImage } from "@bettertavern/core/api/types";
import { readableColumn } from "@bettertavern/design/layout";
import type { ReadingPrefs } from "@bettertavern/core/play/reading";
import {
  actionNote,
  isEnded,
  type PendingTurn,
  type Phase,
  type PlayState,
  type StoryTurn,
} from "@bettertavern/core/play/turnMachine";

import { space, useComic } from "../../theme/index.ts";
import { CastSegments } from "./CastParts.tsx";
import {
  ActionNote,
  EndMark,
  Narrative,
  OpeningMissing,
  OpeningSteps,
  useNarrativeStyle,
  type Narr,
} from "./FeedParts.tsx";
import { TurnPicture, type PictureActions } from "./PictureParts.tsx";

type Item = { key: string; turn: StoryTurn } | { key: "pending"; pending: PendingTurn };

const FOLLOW_THRESHOLD = 80;

const TurnBlock = memo(function TurnBlock({
  turn,
  cast,
  narr,
  images,
  pictures,
}: {
  turn: StoryTurn;
  cast: readonly CastMember[];
  narr: Narr;
  images: TurnImage[] | undefined;
  pictures?: PictureActions;
}) {
  // “写结局”这类说明随界面语言：切换语言时这一块要跟着重画（它是 memo 的）
  useTranslation();
  const note = actionNote(turn.action);
  return (
    <View style={styles.turn}>
      {note ? <ActionNote text={note} narr={narr} /> : null}
      {turn.segments.length > 0 ? (
        <CastSegments
          segments={turn.segments}
          cast={cast}
          render={(segment) => <Narrative text={segment.text} narr={narr} />}
        />
      ) : (
        <Narrative text={turn.narrative} narr={narr} />
      )}
      {pictures ? <TurnPicture turnId={turn.id} images={images} actions={pictures} /> : null}
    </View>
  );
});

function PendingBlock({
  pending,
  phase,
  cast,
  narr,
}: {
  pending: PendingTurn;
  phase: Phase;
  cast: readonly CastMember[];
  narr: Narr;
}) {
  const c = useComic();
  const failed = phase === "failed";
  const opening = pending.action?.source === "opening";
  const note = actionNote(pending.action);
  const caret =
    failed || phase === "submitting"
      ? undefined
      : phase === "reconnecting" || phase === "polling"
        ? c.line2
        : c.acc;
  if (opening && !failed && pending.narrative === "") {
    return <OpeningSteps building={pending.buildingWorld} />;
  }
  return (
    <View style={styles.turn}>
      {note ? <ActionNote text={note} narr={narr} /> : null}
      {pending.segments.length > 0 ? (
        <CastSegments
          segments={pending.segments}
          cast={cast}
          render={(segment, last) => (
            <Narrative
              text={segment.text}
              narr={narr}
              dim={failed}
              caret={last ? caret : undefined}
              interrupted={last && failed && segment.text.length > 0}
            />
          )}
        />
      ) : (
        <Narrative
          text={pending.narrative}
          narr={narr}
          dim={failed}
          caret={caret}
          interrupted={failed && pending.narrative.length > 0}
        />
      )}
    </View>
  );
}

/** 页面经 ref 调用：回到最新一段并恢复跟随 */
export type StoryFeedHandle = { jumpToLatest: () => void };

export function StoryFeed({
  ref,
  state,
  header,
  reading,
  footer,
  dimmed,
  bottomInset,
  available,
  onAwayChange,
  pictures,
}: {
  ref?: Ref<StoryFeedHandle>;
  state: PlayState;
  header?: ReactElement;
  /** 接在最后一段后面的行动区 */
  footer?: ReactElement;
  reading: ReadingPrefs;
  /** 同步中：内容变淡 */
  dimmed?: boolean;
  /** 底部被操作栏（和展开时的键盘）盖住的高度：内容在它上方结束 */
  bottomInset: number;
  /** 阅读区的宽度（世界状态停靠时比窗口窄）：正文栏在里面居中 */
  available: number;
  /** 离开 / 回到最新位置（离底超过 80pt） */
  onAwayChange?: (away: boolean) => void;
  /** 配图的几个操作（要稳定，否则每段都会重画）；不给时不显示“画这一幕” */
  pictures?: PictureActions;
}) {
  const narr = useNarrativeStyle(reading, state.language);
  const list = useRef<FlatList<Item>>(null);
  // 最后一项离操作栏 16
  const bottomSpace = bottomInset + space.l;
  const following = useRef(true);
  const byUser = useRef(false); // 玩家正在拖动，或者拖动之后的惯性滚动
  const away = useRef(false);
  const awayRef = useRef(onAwayChange);
  awayRef.current = onAwayChange;
  const setAway = useCallback((next: boolean) => {
    if (away.current === next) return;
    away.current = next;
    awayRef.current?.(next);
  }, []);

  const items = useMemo(() => {
    const result: Item[] = state.turns.map((turn) => ({ key: turn.id, turn }));
    if (state.pending) result.push({ key: "pending", pending: state.pending });
    return result;
  }, [state.turns, state.pending]);

  const track = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const atBottom = distance < FOLLOW_THRESHOLD;
      if (!atBottom && !byUser.current) return;
      following.current = atBottom;
      setAway(!atBottom);
    },
    [setAway],
  );

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

  // 操作栏高度变了（展开输入框、弹出键盘）：底部留白跟着变，停在底部时继续贴住最新
  useEffect(() => {
    stickToEnd();
  }, [bottomInset, stickToEnd]);

  const jumpToLatest = useCallback(() => {
    following.current = true;
    setAway(false);
    list.current?.scrollToEnd({ animated: true });
  }, [setAway]);
  useImperativeHandle(ref, () => ({ jumpToLatest }), [jumpToLatest]);

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      "turn" in item ? (
        <TurnBlock
          turn={item.turn}
          cast={state.cast}
          narr={narr}
          images={state.images[item.turn.id]}
          pictures={pictures}
        />
      ) : (
        <PendingBlock pending={item.pending} phase={state.phase} cast={state.cast} narr={narr} />
      ),
    [state.phase, state.cast, state.images, narr, pictures],
  );

  const missingOpening = state.turns.length === 0 && state.phase === "idle";
  const ended = isEnded(state);
  return (
    <View style={{ flex: 1, opacity: dimmed ? 0.4 : 1 }}>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        // 正文栏两侧的空白：手机上是 0（正文本来就离边 24）
        contentContainerStyle={{ paddingHorizontal: sideInset(available) }}
        ListHeaderComponent={header}
        // 行动区和底部留白放在列表尾部而不是 paddingBottom：scrollToEnd 只算到尾部组件，不算内边距
        ListFooterComponent={
          <>
            {missingOpening ? <OpeningMissing /> : null}
            {ended ? <EndMark /> : null}
            {footer}
            <View style={{ height: bottomSpace }} />
          </>
        }
        scrollIndicatorInsets={{ bottom: bottomInset }}
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
    </View>
  );
}

/** 阅读栏两侧多出来的空白（不算正文自己的 24 页边距） */
export function sideInset(available: number): number {
  return Math.max(0, readableColumn(available).left - space.read);
}

/** 阅读栏连同页边距的宽度：书名页的封面按它算 */
export function columnWidth(available: number): number {
  return available - sideInset(available) * 2;
}

const styles = StyleSheet.create({
  turn: { marginBottom: space.l },
});
