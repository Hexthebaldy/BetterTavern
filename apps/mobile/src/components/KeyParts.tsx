/**
 * 密钥相关页面共用的小件：服务商标记、API Key 输入框（框里右侧一个“粘贴”胶囊）。
 */

import * as Clipboard from "expo-clipboard";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { font, onColor, usePalette } from "../theme/index.ts";
import { Field, Icon, type FieldProps } from "./ui.tsx";

export type MarkTone = "ink" | "acc" | "card" | "grey";

/** 服务商的圆形标记：DS / HF / { }。ink = 正在用作导演，acc = 选中的服务商 */
export function ProviderMark({
  mark,
  size = 44,
  tone = "card",
}: {
  mark: string;
  size?: number;
  tone?: MarkTone;
}) {
  const palette = usePalette();
  const bg =
    tone === "ink"
      ? palette.ink
      : tone === "acc"
        ? palette.acc
        : tone === "grey"
          ? palette.bg2
          : palette.card;
  const fg = tone === "ink" ? palette.bg : tone === "acc" ? onColor : palette.ink;
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text
        style={{ fontFamily: font.monoMedium, fontSize: size > 40 ? 13 : size > 30 ? 12 : 10, color: fg }}
      >
        {mark}
      </Text>
    </View>
  );
}

/** API Key 输入框：等宽、隐藏输入，框里右侧一个“粘贴”胶囊 */
export function KeyField(props: Omit<FieldProps, "trailing" | "trailingWidth" | "mono" | "secureTextEntry">) {
  const palette = usePalette();
  const paste = async (): Promise<void> => {
    const text = (await Clipboard.getStringAsync().catch(() => "")).trim();
    if (text) props.onChangeText?.(text);
  };
  return (
    <Field
      {...props}
      mono
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      trailingWidth={84}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="粘贴 API Key"
          onPress={() => void paste()}
          style={({ pressed }) => [
            styles.paste,
            { backgroundColor: palette.ink, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          <Icon name="paste" size={16} color={palette.bg} />
          <Text style={{ fontSize: 13.5, color: palette.bg }}>粘贴</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center" },
  paste: {
    height: 40,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});
