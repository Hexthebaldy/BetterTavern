/**
 * 密钥相关页面共用的小件：服务商标记、API Key 输入框（带“粘贴”）。
 */

import * as Clipboard from "expo-clipboard";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { font, usePalette } from "../theme/index.ts";
import { Field, Icon, type FieldProps } from "./ui.tsx";

/** 服务商的方形标记：DS / HF / { }；filled 时黑底白字 */
export function ProviderMark({
  mark,
  size = 44,
  filled,
  dashed,
  inverse,
}: {
  mark: string;
  size?: number;
  filled?: boolean;
  dashed?: boolean;
  /** 放在黑底上（选中的服务商图块里） */
  inverse?: boolean;
}) {
  const palette = usePalette();
  const fg = filled ? palette.bg : inverse ? palette.bg : palette.ink;
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size },
        filled
          ? { backgroundColor: palette.ink }
          : { borderWidth: 1.5, borderColor: fg, borderStyle: dashed ? "dashed" : "solid" },
      ]}
    >
      <Text
        style={{ fontFamily: font.monoMedium, fontSize: size > 30 ? 13 : size > 24 ? 11 : 9.5, color: fg }}
      >
        {mark}
      </Text>
    </View>
  );
}

/** API Key 输入框：等宽、隐藏输入，右边一个“粘贴”按钮 */
export function KeyField(props: Omit<FieldProps, "action" | "mono" | "secureTextEntry">) {
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
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="粘贴 API Key"
          onPress={() => void paste()}
          style={({ pressed }) => [
            styles.paste,
            { backgroundColor: palette.ink, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Icon name="paste" size={18} color={palette.bg} />
          <Text style={{ fontSize: 14, color: palette.bg }}>粘贴</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center" },
  paste: { height: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6 },
});
