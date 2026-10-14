/**
 * 阅读页底部的行动栏：位置固定，只换内容。
 *
 * - 两个选项：整行按钮，左边 A / B 字母键，右边箭头；“自己写…”是第三行。点下后选中行变蓝底、其余变灰，直到服务端确认。
 * - 自由输入：默认收起；收起不清空草稿，剩 200 字以内时显示剩余字数。
 * - 生成中：“停止”；开场没写：“开始故事”；失败：重试 / 换个行动（没有模型时去设置）；同步中暂时锁住。
 *
 * 顶边就是状态灯：空闲时黑色，生成中有一段蓝线来回扫（表示在写，不代表进度），重连时琥珀色，失败时红色。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { TurnOption } from "../../api/types.ts";
import { Button, Icon } from "../../components/ui.tsx";
import { font, space, usePalette } from "../../theme/index.ts";
import { canAct, canRetry, headTurn, isLive, needsOpening, type PlayState } from "./turnMachine.ts";
import type { PlayControls } from "./usePlaySession.ts";

const MAX_TEXT = 2000;
const KEYS = ["A", "B", "C", "D"];

type Edge = "idle" | "live" | "warn" | "error" | "muted";

/** 顶边：生成中是 2px 黑线上一段来回扫的蓝线 */
function TopEdge({ edge }: { edge: Edge }) {
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (edge !== "live") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [edge, sweep]);
  const color =
    edge === "warn"
      ? palette.warn
      : edge === "error"
        ? palette.err
        : edge === "muted"
          ? palette.line
          : palette.ink;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        styles.edge,
        { height: edge === "live" ? 2 : 1, top: edge === "live" ? -1 : 0, backgroundColor: color },
      ]}
    >
      {edge === "live" ? (
        <Animated.View
          style={{
            width: width * 0.28,
            height: 2,
            backgroundColor: palette.acc,
            transform: [
              { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, width * 0.72] }) },
            ],
          }}
        />
      ) : null}
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
            borderBottomColor: palette.line,
            backgroundColor: on ? palette.accBg : palette.bg,
            opacity: dimmed ? 0.4 : 1,
          },
        ];
      }}
    >
      {({ pressed }) => {
        const on = chosen || pressed;
        return (
          <>
            <View
              style={[
                styles.key,
                on ? { backgroundColor: palette.acc } : { borderWidth: 1, borderColor: palette.ink },
              ]}
            >
              <Text style={[styles.keyText, { color: on ? palette.bg : palette.ink }]}>
                {KEYS[index] ?? "·"}
              </Text>
            </View>
            <Text style={[styles.optionText, { color: palette.ink }]}>{option.text}</Text>
            <Icon name="arrowRight" size={18} color={on ? palette.acc : palette.mut} />
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
  const trimmed = draft.trim();
  const left = MAX_TEXT - draft.length;
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
        style={[styles.input, { color: palette.ink, borderColor: palette.ink, backgroundColor: palette.bg }]}
      />
      <View style={styles.inputRow}>
        {onClose ? (
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.collapse}>
            <Icon name="chevronDown" size={20} />
            <Text style={{ fontSize: 15, color: palette.ink }}>收起</Text>
          </Pressable>
        ) : null}
        {left <= 200 ? <Text style={[styles.left, { color: palette.mut }]}>剩 {left}</Text> : null}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || !trimmed }}
          disabled={disabled || !trimmed}
          onPress={() => onSend(trimmed)}
          style={[styles.send, { backgroundColor: disabled || !trimmed ? palette.bg3 : palette.ink }]}
        >
          <Icon name="send" size={18} color={disabled || !trimmed ? palette.mut : palette.bg} />
          <Text
            style={{
              fontSize: 15,
              fontWeight: "500",
              color: disabled || !trimmed ? palette.mut : palette.bg,
            }}
          >
            发送
          </Text>
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
  return (
    <View style={styles.gen}>
      <View
        style={[
          styles.genDot,
          reconnecting ? { borderWidth: 1.5, borderColor: palette.warn } : { backgroundColor: palette.acc },
        ]}
      />
      <Text style={{ flex: 1, fontSize: 15, color: palette.ink }}>{label}</Text>
      {onStop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="停止"
          onPress={onStop}
          style={({ pressed }) => [
            styles.stop,
            { borderColor: palette.ink, backgroundColor: pressed ? palette.bg2 : palette.bg },
          ]}
        >
          <Icon name="stop" size={14} />
          <Text style={{ fontSize: 15, color: palette.ink }}>停止</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ActionBar({
  state,
  controls,
  onOpenSettings,
}: {
  state: PlayState;
  controls: PlayControls;
  onOpenSettings: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");

  if (state.phase === "loading" || state.phase === "load_failed") return null;

  let edge: Edge = "idle";
  let content: ReactNode;
  const submission = state.submission;
  if (state.phase === "syncing") {
    edge = "muted";
    content = (
      <View style={styles.gen}>
        <Icon name="lock" size={18} color={palette.mut} />
        <Text style={{ fontSize: 14, color: palette.mut }}>同步完成前，暂时不能行动</Text>
      </View>
    );
  } else if (state.phase === "failed" && state.error) {
    edge = "error";
    const routeMissing = state.error.code === "ROUTE_MISSING";
    const opening = state.turns.length === 0;
    content = (
      <View style={styles.failed}>
        <View style={styles.failText} accessibilityRole="alert">
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
            style={styles.flex}
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
      <View style={{ padding: space.m }}>
        <Button
          label="开始故事"
          trailingIcon="arrowRight"
          between
          onPress={() => controls.submit({ source: "opening" })}
        />
      </View>
    );
  } else if (state.phase === "submitting" && submission?.action.source === "option") {
    // 发送中：选中的那一项保持蓝底，其余变灰，直到服务端确认
    const options = headTurn(state)?.options ?? [];
    const picked = submission.action.option_id;
    edge = "live";
    content = (
      <View>
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
    const reconnecting = state.phase === "reconnecting" || state.phase === "polling";
    edge = reconnecting ? "warn" : "live";
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
        <View>
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
            style={({ pressed }) => [styles.write, { backgroundColor: pressed ? palette.bg2 : palette.bg }]}
          >
            <View style={[styles.key, { borderWidth: 1, borderColor: palette.line2 }]}>
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
    <View style={[styles.bar, { backgroundColor: palette.bg, paddingBottom: insets.bottom }]}>
      <TopEdge edge={edge} />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "relative" },
  edge: { position: "absolute", left: 0, right: 0, zIndex: 1, overflow: "hidden" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingVertical: space.m,
    paddingLeft: space.page,
    paddingRight: space.l,
    borderBottomWidth: 1,
  },
  key: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  keyText: { fontFamily: font.monoMedium, fontSize: 13 },
  optionText: { flex: 1, fontSize: 15, lineHeight: 22 },
  write: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 56,
    paddingLeft: space.page,
    paddingRight: space.l,
  },
  inputBlock: { paddingTop: space.m, paddingHorizontal: space.m, paddingBottom: space.s, gap: space.s },
  input: {
    height: 124,
    borderWidth: 2,
    paddingHorizontal: 14,
    paddingTop: space.m,
    paddingBottom: space.m,
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
    paddingLeft: 6,
    paddingRight: space.m,
  },
  left: { fontFamily: font.mono, fontSize: 12 },
  send: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 44,
    paddingLeft: 14,
    paddingRight: 18,
  },
  gen: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    height: 68,
    paddingLeft: space.page,
    paddingRight: space.m,
  },
  genDot: { width: 8, height: 8 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 44,
    paddingLeft: 14,
    paddingRight: space.l,
    borderWidth: 1,
  },
  failed: { paddingTop: 14, paddingHorizontal: space.m, paddingBottom: space.m, gap: space.m },
  failText: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingHorizontal: space.s },
  buttons: { flexDirection: "row", gap: space.s },
  flex: { flex: 1 },
});
