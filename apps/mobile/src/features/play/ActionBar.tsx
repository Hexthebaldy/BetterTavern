/**
 * 阅读页底部的行动面板：浮在故事上面，左、右、下各离屏幕边缘 8，圆角 36，带向上的柔和投影。位置固定，只换内容。
 *
 * - 两个选项：圆角灰卡，左边 A / B 圆形字母键；“自己写…”是第三行（透明底）。点下后选中项变浅蓝底加蓝色内描边、
 *   其余变淡，直到服务端确认。
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
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { TurnOption } from "../../api/types.ts";
import { Button, Icon, useSheetSurfaces } from "../../components/ui.tsx";
import { font, radius, size, space, usePalette } from "../../theme/index.ts";
import { canAct, canRetry, headTurn, isLive, needsOpening, type PlayState } from "./turnMachine.ts";
import type { PlayControls } from "./usePlaySession.ts";

const MAX_TEXT = 2000;
const KEYS = ["A", "B", "C", "D"];
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

/** 拖拽条形状的状态条：一段 18 宽的颜色在 44 宽的槽里来回移动 */
function Handle({ warn }: { warn: boolean }) {
  const palette = usePalette();
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const { width, height, segment } = size.handle;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.handle,
        { width, height, borderRadius: height / 2, backgroundColor: warn ? palette.warnBg : palette.bg3 },
      ]}
    >
      <Animated.View
        style={{
          width: segment,
          height,
          borderRadius: height / 2,
          backgroundColor: warn ? palette.warn : palette.acc,
          opacity: warn ? 0.6 : 1,
          transform: [
            { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, width - segment] }) },
          ],
        }}
      />
    </View>
  );
}

function OptionRow({
  option,
  index,
  disabled,
  chosen,
  dimmed,
  onPress,
}: {
  option: TurnOption;
  index: number;
  disabled: boolean;
  chosen: boolean;
  dimmed: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${KEYS[index] ?? ""}：${option.text}`}
      accessibilityHint="选择这个行动"
      accessibilityState={{ disabled, selected: chosen }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => {
        const on = chosen || pressed;
        return [
          styles.option,
          {
            backgroundColor: on ? palette.accBg : surfaces.fill,
            boxShadow: on ? `inset 0 0 0 2px ${palette.acc}` : undefined,
            opacity: dimmed ? 0.4 : 1,
            transform: [{ scale: on ? 0.98 : 1 }],
          },
        ];
      }}
    >
      {({ pressed }) => {
        const on = chosen || pressed;
        return (
          <>
            <View style={[styles.key, { backgroundColor: on ? palette.acc : palette.sheet }]}>
              <Text style={[styles.keyText, { color: on ? palette.bg : palette.ink }]}>
                {KEYS[index] ?? "·"}
              </Text>
            </View>
            <Text style={[styles.optionText, { color: palette.ink }]}>{option.text}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

function FreeInput({
  draft,
  onDraft,
  disabled,
  onSend,
  onClose,
}: {
  draft: string;
  onDraft: (text: string) => void;
  disabled: boolean;
  onSend: (text: string) => void;
  /** 没有选项时没法收起 */
  onClose: (() => void) | null;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const [focused, setFocused] = useState(false);
  const trimmed = draft.trim();
  const left = MAX_TEXT - draft.length;
  const blocked = disabled || !trimmed;
  return (
    <View style={styles.inputBlock}>
      <TextInput
        value={draft}
        onChangeText={onDraft}
        placeholder="我……（用第一人称写下你要做的事）"
        placeholderTextColor={palette.mut}
        multiline
        autoFocus={onClose !== null}
        maxLength={MAX_TEXT}
        accessibilityLabel="我要做的事"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          {
            color: palette.ink,
            backgroundColor: surfaces.fill,
            boxShadow: focused ? `inset 0 0 0 2px ${palette.acc}` : undefined,
          },
        ]}
      />
      <View style={styles.inputRow}>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.collapse,
              { backgroundColor: surfaces.fill, transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Icon name="chevronDown" size={20} />
            <Text style={{ fontSize: 15, color: palette.ink }}>收起</Text>
          </Pressable>
        ) : null}
        {left <= 200 ? <Text style={[styles.left, { color: palette.mut }]}>剩 {left}</Text> : null}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked }}
          disabled={blocked}
          onPress={() => onSend(trimmed)}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: palette.pri,
              opacity: blocked ? 0.3 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
        >
          <View style={[styles.sendIcon, { backgroundColor: palette.arrowBg }]}>
            <Icon name="send" size={16} color={palette.onPri} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "500", color: palette.onPri }}>发送</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Generating({
  label,
  reconnecting,
  onStop,
}: {
  label: string;
  reconnecting: boolean;
  onStop: (() => void) | null;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  return (
    <View>
      <Handle warn={reconnecting} />
      <View style={styles.gen}>
        <View
          style={[
            styles.genDot,
            reconnecting
              ? { backgroundColor: palette.warn }
              : { backgroundColor: palette.acc, boxShadow: `0 0 0 4px ${palette.accBg}` },
          ]}
        />
        <Text style={{ flex: 1, fontSize: 15, color: palette.ink }}>
          {label}
          {reconnecting ? <Text style={{ fontSize: 13, color: palette.mut }}> · 已写好的不会丢</Text> : null}
        </Text>
        {onStop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="停止"
            onPress={onStop}
            style={({ pressed }) => [
              styles.stop,
              { backgroundColor: surfaces.fill, transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Icon name="stop" size={16} />
            <Text style={{ fontSize: 15, color: palette.ink }}>停止</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ActionBar({
  state,
  controls,
  onOpenSettings,
  onHeight,
  style,
}: {
  state: PlayState;
  controls: PlayControls;
  onOpenSettings: () => void;
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

  let content: ReactNode;
  // 生成中的那几种内容自带拖拽条，面板顶部留白小一些
  let live = false;
  const submission = state.submission;
  if (state.phase === "syncing") {
    content = (
      <View style={styles.locked}>
        <Icon name="lock" size={20} color={palette.mut} />
        <Text style={{ fontSize: 14, color: palette.mut }}>同步完成前，暂时不能行动</Text>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={draft ? "继续写草稿" : "自己写"}
            onPress={() => setWriting(true)}
            disabled={!enabled}
            style={({ pressed }) => [
              styles.write,
              { backgroundColor: pressed ? surfaces.fill : "transparent", opacity: enabled ? 1 : 0.3 },
            ]}
          >
            <View style={[styles.key, { backgroundColor: surfaces.fill }]}>
              <Icon name="write" size={16} color={palette.mut} />
            </View>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: palette.mut }}>
              {draft ? draft : "自己写…"}
            </Text>
          </Pressable>
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
  handle: { alignSelf: "center", marginTop: 2, marginBottom: 6, overflow: "hidden" },
  options: { gap: 6 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: size.optionRow,
    paddingVertical: 10,
    paddingLeft: space.m,
    paddingRight: 14,
    borderRadius: radius.option,
  },
  key: {
    width: size.optionKey,
    height: size.optionKey,
    borderRadius: size.optionKey / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontFamily: font.monoMedium, fontSize: 13 },
  optionText: { flex: 1, fontSize: 15, lineHeight: 22 },
  write: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 52,
    paddingLeft: space.m,
    paddingRight: 14,
    borderRadius: radius.option,
  },
  inputBlock: { gap: space.s },
  input: {
    height: 124,
    borderRadius: radius.option,
    paddingHorizontal: space.l,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 16,
    lineHeight: 25,
    textAlignVertical: "top",
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: space.s },
  collapse: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingLeft: space.m,
    paddingRight: space.l,
    borderRadius: 22,
  },
  left: { fontFamily: font.mono, fontSize: 12 },
  send: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 44,
    paddingLeft: space.s,
    paddingRight: 18,
    borderRadius: 22,
  },
  sendIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  gen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 56,
    paddingLeft: space.m,
    paddingRight: 4,
  },
  genDot: { width: 8, height: 8, borderRadius: 4 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 48,
    paddingLeft: 14,
    paddingRight: 18,
    borderRadius: 24,
  },
  locked: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64, paddingHorizontal: space.m },
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
