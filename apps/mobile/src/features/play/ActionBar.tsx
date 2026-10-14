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
 * 面板的高度经 onHeight 报给页面：故事流的底部留白、“回到最新”的位置都跟着它走，内容不会被挡住。
 * 底部安全区（Home 指示条）算在面板的内边距里；键盘弹出时面板贴着键盘浮起，不再留安全区。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Icon, useSheetSurfaces } from "../../components/ui.tsx";
import { radius, space, usePalette } from "../../theme/index.ts";
import { FreeInput, Generating, OptionRow, PanelTools, WriteRow } from "./ActionParts.tsx";
import { canAct, canRetry, headTurn, isLive, needsOpening, type PlayState } from "./turnMachine.ts";
import type { PlayControls } from "./usePlaySession.ts";

/** 面板离屏幕左、右、下边缘的距离 */
export const PANEL_GAP = space.s;

/**
 * 键盘盖住的高度，以及让面板跟着键盘浮起的动画值（iOS）。
 * 不用 KeyboardAvoidingView：它收起键盘时走 LayoutAnimation，之后的第一次点按会丢。
 * Android 的窗口会随键盘缩小，这里不用再抬。
 */
function useKeyboardLift(): { height: number; lift: Animated.Value } {
  const lift = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const move = (to: number, duration: number): void => {
      setHeight(to);
      if (!ios) return;
      // 不用原生驱动：面板的位置要进布局，按钮的点按区域才跟得上
      Animated.timing(lift, {
        toValue: to,
        duration: duration || 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    };
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      move(e.endCoordinates.height, e.duration),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) =>
      move(0, e.duration),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [lift]);
  return { height: Platform.OS === "ios" ? height : 0, lift };
}

export function ActionBar({
  state,
  controls,
  onOpenSettings,
  onOpenWorld,
  onOpenMore,
  onHeight,
  style,
}: {
  state: PlayState;
  controls: PlayControls;
  onOpenSettings: () => void;
  onOpenWorld: () => void;
  onOpenMore: () => void;
  /** 面板盖住的高度（面板本身加上 iOS 键盘，不含离底的 8），页面据此给故事流留底 */
  onHeight?: (height: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const insets = useSafeAreaInsets();
  const { height: keyboardHeight, lift } = useKeyboardLift();
  const keyboard = keyboardHeight > 0;
  const [panelHeight, setPanelHeight] = useState(0);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (panelHeight > 0) onHeight?.(panelHeight + keyboardHeight);
  }, [panelHeight, keyboardHeight, onHeight]);

  if (state.phase === "loading" || state.phase === "load_failed") return null;

  const tools = <PanelTools onWorld={onOpenWorld} onMore={onOpenMore} />;
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
      <View style={styles.options}>
        {options.map((option, i) => (
          <OptionRow
            key={option.id}
            option={option}
            index={i}
            disabled
            chosen={option.id === picked}
            dimmed={option.id !== picked}
            onPress={() => undefined}
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
          {options.map((option, i) => (
            <OptionRow
              key={option.id}
              option={option}
              index={i}
              disabled={!enabled}
              chosen={false}
              dimmed={false}
              onPress={() => controls.submit({ source: "option", option_id: option.id })}
            />
          ))}
          <WriteRow draft={draft} enabled={enabled} onWrite={() => setWriting(true)} tools={tools} />
        </View>
      );
  }
  return (
    <Animated.View
      onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
      style={[
        styles.panel,
        {
          bottom: Animated.add(lift, PANEL_GAP),
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
    left: PANEL_GAP,
    right: PANEL_GAP,
    bottom: PANEL_GAP,
    paddingHorizontal: space.s,
  },
  options: { gap: 6 },
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
