/**
 * 阅读页底部：两个选项、自由输入（默认收起，不弹键盘）、生成中的“停止”、失败时的“重试”。
 */

import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { TurnOption } from "../../api/types.ts";
import { Button } from "../../components/ui.tsx";
import { space, type, usePalette } from "../../theme/index.ts";
import { canAct, canRetry, headTurn, isBusy, needsOpening, type PlayState } from "./turnMachine.ts";
import type { PlayControls } from "./usePlaySession.ts";

const MAX_TEXT = 2000;

function OptionButton({
  option,
  disabled,
  onPress,
}: {
  option: TurnOption;
  disabled: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={option.text}
      accessibilityHint="选择这个行动"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderLeftColor: palette.accent,
          backgroundColor: pressed ? palette.accentSoft : palette.surface,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[type.action, { color: palette.ink }]}>{option.text}</Text>
    </Pressable>
  );
}

function FreeInput({
  disabled,
  onSend,
  onClose,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const send = (): void => {
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };
  return (
    <View style={styles.inputBlock}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="我……（用第一人称写下你要做的事）"
        placeholderTextColor={palette.muted}
        multiline
        autoFocus
        maxLength={MAX_TEXT}
        accessibilityLabel="自己写行动"
        style={[
          type.action,
          styles.input,
          { color: palette.ink, backgroundColor: palette.surface, borderColor: palette.rule },
        ]}
      />
      <View style={styles.inputRow}>
        <Button label="收起" variant="plain" onPress={onClose} />
        {text.length > MAX_TEXT - 200 ? (
          <Text style={[type.caption, { color: palette.muted }]}>
            {text.length}/{MAX_TEXT}
          </Text>
        ) : null}
        <Button label="发送" onPress={send} disabled={disabled || !trimmed} style={styles.send} />
      </View>
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
  const [writing, setWriting] = useState(false);

  if (state.phase === "loading" || state.phase === "load_failed" || state.phase === "syncing") return null;

  let content: ReactNode = null;
  if (state.phase === "failed" && state.error) {
    const routeMissing = state.error.code === "ROUTE_MISSING";
    content = (
      <View>
        <Text style={[type.body, { color: palette.danger, marginBottom: space.m }]} accessibilityRole="alert">
          {state.error.message}
        </Text>
        <View style={styles.buttons}>
          {routeMissing ? (
            <Button label="去设置模型" onPress={onOpenSettings} style={styles.flex} />
          ) : canRetry(state) ? (
            <Button label="重试" onPress={controls.retry} style={styles.flex} />
          ) : null}
          <Button
            label={state.turns.length > 0 ? "换个行动" : "关闭"}
            variant="secondary"
            onPress={controls.dismissError}
            style={styles.flex}
          />
        </View>
      </View>
    );
  } else if (needsOpening(state)) {
    content = <Button label="开始故事" onPress={() => controls.submit({ source: "opening" })} />;
  } else if (isBusy(state)) {
    const cancellable = state.pending?.turnId != null && state.phase !== "submitting";
    content = cancellable ? (
      <View style={styles.busyRow}>
        <Text style={[type.caption, { color: palette.muted, flex: 1 }]}>
          {state.pending?.action?.source === "opening" ? "正在写开场" : "正在写下一段"}
        </Text>
        <Button label="停止" variant="secondary" onPress={controls.cancel} />
      </View>
    ) : null;
  } else {
    const head = headTurn(state);
    const enabled = canAct(state);
    const options = head?.options ?? [];
    content =
      writing || options.length === 0 ? (
        <FreeInput
          disabled={!enabled}
          onSend={(text) => {
            setWriting(false);
            controls.submit({ source: "text", text });
          }}
          onClose={() => setWriting(false)}
        />
      ) : (
        <View>
          {options.map((option) => (
            <OptionButton
              key={option.id}
              option={option}
              disabled={!enabled}
              onPress={() => controls.submit({ source: "option", option_id: option.id })}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => setWriting(true)}
            disabled={!enabled}
            hitSlop={8}
            style={styles.write}
          >
            <Text style={[type.body, { color: palette.muted }]}>自己写…</Text>
          </Pressable>
        </View>
      );
  }
  if (content === null) return null;
  return (
    <View style={[styles.bar, { borderTopColor: palette.rule, backgroundColor: palette.paper }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.l,
    paddingTop: space.m,
    paddingBottom: space.s,
  },
  option: {
    borderLeftWidth: 2,
    borderRadius: 4,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    marginBottom: space.s,
    minHeight: 48,
    justifyContent: "center",
  },
  write: { paddingVertical: space.s, alignSelf: "flex-start" },
  buttons: { flexDirection: "row", gap: space.m },
  flex: { flex: 1 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  inputBlock: { gap: space.s },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    minHeight: 72,
    maxHeight: 160,
    textAlignVertical: "top",
  },
  inputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.m },
  send: { minWidth: 88 },
});
