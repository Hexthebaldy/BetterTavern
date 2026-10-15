/**
 * 阅读页底部的行动面板：浮在故事上面，左、右、下各离屏幕边缘 8，圆角 36，带向上的柔和投影。位置固定，只换内容。
 *
 * - 两个选项：圆角灰卡，左边 A / B 圆形字母键；“自己写…”是第三行（透明底）。点下后选中项变浅蓝底加蓝色内描边、
 *   其余变淡，直到服务端确认。
 * - 世界状态和“更多”（阅读设置、重命名、删除）两个圆按钮在面板右下角：空闲时在“自己写…”右边，
 *   生成中在“停止”左边，同步中在提示右边。导航栏右侧不再放按钮。
 * - 自由输入：默认收起；收起不清空草稿，剩 200 字以内时显示剩余字数。
 * - 生成中：顶部拖拽条里一段蓝色来回移动（表示在写，不代表进度），下面是“正在写下一段”和“停止”；重连时琥珀色。
 * - 开场没写：“开始故事”；失败：错误卡片加重试 / 换个行动（没有模型时去设置）；同步中暂时锁住。
 *
 * 面板盖住的高度经 onHeight 报给页面：故事流的底部留白、“回到最新”的位置都跟着它走，内容不会被挡住。
 * 底部安全区（Home 指示条）算在面板的内边距里；键盘弹出时面板贴着键盘浮起，不再留安全区。
 *
 * 平板（theme/layout.ts）：面板宽 672，和阅读栏同一条中线（世界状态停靠时在剩下的宽度里居中），
 * 离底 20 加安全区；宽屏的选项排成两列网格，每格最小高 76，奇数个时最后一项占满一行。
 */

import { useEffect, useState, type ReactNode, type Ref } from "react";
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon, useSheetSurfaces } from "../../components/ui.tsx";
import { useKeyboardLift } from "../../hooks/useKeyboardLift.ts";
import { useLayout } from "../../hooks/useLayout.ts";
import { radius, space, usePalette } from "../../theme/index.ts";
import { actionPanelFrame, optionColumns } from "../../theme/layout.ts";
import { FreeInput, Generating, OptionRow, PanelTools, WriteRow } from "./ActionParts.tsx";
import { canAct, canRetry, headTurn, isLive, needsOpening, type PlayState } from "./turnMachine.ts";
import type { PlayControls } from "./usePlaySession.ts";

/** 面板离屏幕左、右、下边缘的距离（手机） */
export const PANEL_GAP = space.s;
/** 平板上面板离底（安全区之上） */
const TABLET_BOTTOM = 20;
/** 平板两列选项的最小高度 */
const GRID_OPTION_HEIGHT = 76;

export function ActionBar({
  state,
  controls,
  onOpenSettings,
  onOpenWorld,
  onOpenMore,
  onHeight,
  available,
  worldActive,
  moreActive,
  moreRef,
  panelRef,
  style,
}: {
  state: PlayState;
  controls: PlayControls;
  onOpenSettings: () => void;
  onOpenWorld: () => void;
  onOpenMore: () => void;
  /** 面板盖住的高度（面板本身、离底的距离，加上 iOS 键盘），页面据此给故事流留底 */
  onHeight?: (height: number) => void;
  /** 阅读区的宽度（世界状态停靠时比窗口窄），面板在里面居中 */
  available: number;
  /** 世界状态停靠着：世界按钮显示为选中 */
  worldActive?: boolean;
  /** “更多”菜单开着：更多按钮显示为选中 */
  moreActive?: boolean;
  /** “更多”按钮和面板本身：平板上“更多”菜单贴着按钮、在面板上方弹出 */
  moreRef?: Ref<View>;
  panelRef?: Ref<View>;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const insets = useSafeAreaInsets();
  const { size: layoutSize, compact } = useLayout();
  const { height: keyboardHeight, lift } = useKeyboardLift();
  const keyboard = keyboardHeight > 0;
  const [panelHeight, setPanelHeight] = useState(0);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const frame = actionPanelFrame(available);
  // 面板底边离屏幕底边（键盘之外）：手机 8，平板 20 加安全区；键盘弹出时贴着键盘
  const gap = compact || keyboard ? PANEL_GAP : TABLET_BOTTOM + insets.bottom;

  useEffect(() => {
    if (panelHeight > 0) onHeight?.(panelHeight + keyboardHeight + gap);
  }, [panelHeight, keyboardHeight, gap, onHeight]);

  if (state.phase === "loading" || state.phase === "load_failed") return null;

  const tools = (
    <PanelTools
      onWorld={onOpenWorld}
      onMore={onOpenMore}
      worldActive={worldActive}
      moreActive={moreActive}
      moreRef={moreRef}
    />
  );
  // 宽屏两列：面板内宽减去中间 6，平分；奇数个时最后一项占满一行
  const inner = frame.width - space.s * 2;
  const twoColumns = optionColumns(layoutSize) === 2;
  const optionStyle = (i: number, count: number): StyleProp<ViewStyle> =>
    twoColumns
      ? {
          width: count % 2 === 1 && i === count - 1 ? inner : (inner - 6) / 2,
          minHeight: GRID_OPTION_HEIGHT,
        }
      : null;
  const optionsStyle = twoColumns ? [styles.options, styles.grid] : styles.options;
  let content: ReactNode;
  // 生成中的那几种内容自带拖拽条，面板顶部留白小一些
  let live = false;
  const submission = state.submission;
  if (state.phase === "syncing") {
    content = (
      <View style={styles.locked}>
        <Icon name="lock" size={20} color={palette.mut} />
        <Text style={{ flex: 1, fontSize: 14, color: palette.mut }}>同步完成前，暂时不能行动</Text>
        {tools}
      </View>
    );
  } else if (state.phase === "failed" && state.error) {
    const routeMissing = state.error.code === "ROUTE_MISSING";
    const opening = state.turns.length === 0;
    content = (
      <View style={styles.column}>
        <View style={[styles.failCard, { backgroundColor: palette.errBg }]} accessibilityRole="alert">
          <Icon name="alert" size={20} color={palette.err} />
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 21, color: palette.err }}>
            {routeMissing
              ? "没有可用模型。先添加密钥，再选一个导演模型。"
              : state.pending?.narrative
                ? `这一段没写完：${state.error.message}`
                : state.error.message}
          </Text>
        </View>
        <View style={styles.buttons}>
          <Button
            label={opening ? "关闭" : "换个行动"}
            variant="secondary"
            onPress={controls.dismissError}
            style={[styles.flex, { backgroundColor: surfaces.fill }]}
          />
          {routeMissing ? (
            <Button label="去设置模型" onPress={onOpenSettings} style={styles.flex} />
          ) : canRetry(state) ? (
            <Button label="重试" icon="retry" onPress={controls.retry} style={styles.flex} />
          ) : null}
        </View>
      </View>
    );
  } else if (needsOpening(state)) {
    content = (
      <Button
        label="开始故事"
        trailingIcon="arrowRight"
        between
        onPress={() => controls.submit({ source: "opening" })}
      />
    );
  } else if (state.phase === "submitting" && submission?.action.source === "option") {
    // 发送中：选中的那一项保持蓝底，其余变淡，直到服务端确认
    const options = headTurn(state)?.options ?? [];
    const picked = submission.action.option_id;
    content = (
      <View style={optionsStyle}>
        {options.map((option, i) => (
          <OptionRow
            key={option.id}
            option={option}
            index={i}
            disabled
            chosen={option.id === picked}
            dimmed={option.id !== picked}
            onPress={() => undefined}
            style={optionStyle(i, options.length)}
          />
        ))}
      </View>
    );
  } else if (isLive(state)) {
    live = true;
    const reconnecting = state.phase === "reconnecting" || state.phase === "polling";
    const cancellable = state.pending?.turnId != null && state.phase !== "submitting";
    const opening = state.pending?.action?.source === "opening";
    content = (
      <Generating
        label={state.phase === "submitting" ? "正在发送…" : opening ? "正在写开场" : "正在写下一段"}
        reconnecting={reconnecting}
        onStop={cancellable ? controls.cancel : null}
        tools={tools}
      />
    );
  } else {
    const head = headTurn(state);
    const enabled = canAct(state);
    const options = head?.options ?? [];
    const send = (text: string): void => {
      setWriting(false);
      setDraft("");
      controls.submit({ source: "text", text });
    };
    content =
      writing || options.length === 0 ? (
        <FreeInput
          draft={draft}
          onDraft={setDraft}
          disabled={!enabled}
          onSend={send}
          onClose={options.length > 0 ? () => setWriting(false) : null}
        />
      ) : (
        <View style={styles.options}>
          <View style={optionsStyle}>
            {options.map((option, i) => (
              <OptionRow
                key={option.id}
                option={option}
                index={i}
                disabled={!enabled}
                chosen={false}
                dimmed={false}
                onPress={() => controls.submit({ source: "option", option_id: option.id })}
                style={optionStyle(i, options.length)}
              />
            ))}
          </View>
          <WriteRow draft={draft} enabled={enabled} onWrite={() => setWriting(true)} tools={tools} />
        </View>
      );
  }
  return (
    <Animated.View
      ref={panelRef}
      onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
      style={[
        styles.panel,
        {
          left: frame.left,
          width: frame.width,
          bottom: Animated.add(lift, gap),
          backgroundColor: palette.sheet,
          boxShadow: palette.shadowUp,
          paddingTop: live ? 6 : space.s,
          // Home 指示条压在面板的底边距里，内容停在它上方；键盘弹出时贴着键盘
          paddingBottom: keyboard ? space.s : Math.max(insets.bottom - space.m, space.s),
          borderRadius: keyboard ? radius.sheet : radius.floatingSheet,
        },
        style,
      ]}
    >
      {content}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    bottom: PANEL_GAP,
    paddingHorizontal: space.s,
  },
  options: { gap: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  locked: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 64,
    paddingLeft: space.m,
    paddingRight: 6,
  },
  column: { gap: space.s },
  failCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 14,
    borderRadius: radius.option,
  },
  buttons: { flexDirection: "row", gap: space.s },
  flex: { flex: 1 },
});
