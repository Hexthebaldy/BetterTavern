/**
 * 密钥相关页面共用的小件：服务商标记、API Key 输入框（框里右侧一个“粘贴”胶囊）。
 */

import * as Clipboard from "expo-clipboard";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { providerLogo } from "@bettertavern/design/providerLogos";

import { comicDepth, comicStroke, font, onColor, useComic } from "../theme/index.ts";
import { Field, Icon, press, type FieldProps } from "./ui.tsx";

export type MarkTone = "ink" | "acc" | "card" | "grey";

/**
 * 服务商的圆形标记：2 墨线的圆，有标志的画标志（@bettertavern/design 的 providerLogos.ts，品牌原色；单色标志用当前
 * 文字颜色；带渐变的路径按渐变填，例如 Gemini），没有的（自定义端点）写 { }。ink = 墨底（放在墨底的导演模型格上时
 * 描边是纸色），acc = 选中的服务商。有标志时选中也不把圆涂成蓝色（DeepSeek 的蓝色标志会看不见），选中靠图块自己的蓝框。
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
  const c = useComic();
  const logo = providerLogo(provider);
  // 渐变的 id 在整个页面里要唯一：同一页上可能有好几个同一家的标记
  const gradientId = useId().replace(/[^\w-]/g, "");
  const shown: MarkTone = logo && tone === "acc" ? "card" : tone;
  const bg = shown === "ink" ? c.ink : shown === "acc" ? c.acc : shown === "grey" ? c.grey : c.paper;
  const fg = shown === "ink" ? c.paper : shown === "acc" ? onColor : c.ink;
  const glyph = Math.round(size * 0.5);
  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderColor: shown === "ink" ? c.paper : c.ink,
        },
      ]}
    >
      {logo ? (
        <Svg width={glyph} height={glyph} viewBox={logo.viewBox}>
          <Defs>
            {logo.paths.map((p, i) =>
              p.gradient ? (
                <LinearGradient
                  key={i}
                  id={`${gradientId}-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={p.gradient.x1}
                  y1={p.gradient.y1}
                  x2={p.gradient.x2}
                  y2={p.gradient.y2}
                >
                  {p.gradient.stops.map((stop, j) => (
                    <Stop key={j} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
                  ))}
                </LinearGradient>
              ) : null,
            )}
          </Defs>
          {logo.paths.map((p, i) => (
            <Path
              key={i}
              d={p.d}
              fill={p.gradient ? `url(#${gradientId}-${i})` : (p.fill ?? fg)}
              fillRule={logo.fillRule}
            />
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
  const c = useComic();
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
            { backgroundColor: c.ink, borderColor: c.ink },
            press(pressed, comicDepth.iconButton, c.acc),
          ]}
        >
          <Icon name="paste" size={16} color={c.paper} />
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: c.paper }}>{t("common.paste")}</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center", borderWidth: comicStroke.control },
  paste: {
    height: 36,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 18,
    borderWidth: comicStroke.control,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});
