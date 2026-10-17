/**
 * 密钥相关页面共用的小件：服务商标记、API Key 输入框（框里右侧一个“粘贴”胶囊）。
 */

import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { providerLogo } from "@bettertavern/design/providerLogos";

import { font, onColor, usePalette } from "../theme/index.ts";
import { Field, Icon, type FieldProps } from "./ui.tsx";

export type MarkTone = "ink" | "acc" | "card" | "grey";

/**
 * 服务商的圆形标记：有标志的画标志（@bettertavern/design 的 providerLogos.ts，品牌原色；单色标志用当前文字颜色），
 * 没有的（自定义端点）写 { }。ink = 正在用作导演，acc = 选中的服务商。
 * 有标志时选中也不把圆涂成蓝色（DeepSeek 的蓝色标志会看不见），选中靠图块自己的浅蓝底和描边。
 */
export function ProviderMark({
  provider,
  size = 44,
  tone = "card",
}: {
  provider: string;
  size?: number;
  tone?: MarkTone;
}) {
  const palette = usePalette();
  const logo = providerLogo(provider);
  const shown: MarkTone = logo && tone === "acc" ? "card" : tone;
  const bg =
    shown === "ink"
      ? palette.ink
      : shown === "acc"
        ? palette.acc
        : shown === "grey"
          ? palette.bg2
          : palette.card;
  const fg = shown === "ink" ? palette.bg : shown === "acc" ? onColor : palette.ink;
  const glyph = Math.round(size * 0.56);
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      {logo ? (
        <Svg width={glyph} height={glyph} viewBox={logo.viewBox}>
          {logo.paths.map((p, i) => (
            <Path key={i} d={p.d} fill={p.fill ?? fg} fillRule={logo.fillRule} />
          ))}
        </Svg>
      ) : (
        <Text
          style={{ fontFamily: font.monoMedium, fontSize: size > 40 ? 13 : size > 30 ? 12 : 10, color: fg }}
        >
          {"{ }"}
        </Text>
      )}
    </View>
  );
}

/** API Key 输入框：等宽、隐藏输入，框里右侧一个“粘贴”胶囊 */
export function KeyField(props: Omit<FieldProps, "trailing" | "trailingWidth" | "mono" | "secureTextEntry">) {
  const palette = usePalette();
  const { t } = useTranslation();
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
          accessibilityLabel={t("models.pasteKey")}
          onPress={() => void paste()}
          style={({ pressed }) => [
            styles.paste,
            { backgroundColor: palette.ink, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          <Icon name="paste" size={16} color={palette.bg} />
          <Text style={{ fontSize: 13.5, color: palette.bg }}>{t("common.paste")}</Text>
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
