/**
 * 登录、注册在平板上的版式（设计稿 T01、T02）。手机上原样不动。
 *
 * - 宽屏：左右分栏。左侧一块 bg2、圆角 32 的插画区（Logo、几何插画、一句介绍，照 source/TabletAuth.dc.html 画），
 *   右侧是表单，宽 400，在右半边居中，服务器入口贴在右半边底部。
 * - 中屏：表单宽 440，居中，服务器入口贴底。服务器选择是居中对话框（Sheet 在平板上自己换形态）。
 */

import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { useLayout } from "../hooks/useLayout.ts";
import { radius, space, usePalette } from "../theme/index.ts";
import { Logo } from "./Logo.tsx";

/** 表单的宽度：宽屏 400，中屏 440；手机 null（整宽） */
export function useAuthFormWidth(): number | null {
  const { size } = useLayout();
  return size === "expanded" ? 400 : size === "medium" ? 440 : null;
}

/** 表单那一栏的样式（给左右各有 24 内边距的 ScrollView 内容用）：平板上表单限宽、居中；手机上 null */
export function useAuthColumn(): ViewStyle | null {
  const width = useAuthFormWidth();
  return width === null ? null : { width: "100%", maxWidth: width + space.page * 2, alignSelf: "center" };
}

const WAVE = "q30-14 60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0";

/** 左侧的插画区：船、灯、太阳和水波，线条用墨色，浅一档的用 line2 */
function Art() {
  const palette = usePalette();
  const ink = {
    fill: "none",
    stroke: palette.ink,
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  const soft = { ...ink, stroke: palette.line2 };
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 565 802"
      preserveAspectRatio="xMidYMid slice"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle cx={402} cy={236} r={30} fill={palette.acc} />
      <Circle cx={402} cy={236} r={58} fill="none" stroke={palette.line2} strokeWidth={1.5} />
      <Circle
        cx={402}
        cy={236}
        r={92}
        fill="none"
        stroke={palette.line2}
        strokeWidth={1.5}
        strokeDasharray="2 7"
      />
      <Path d="M60 330h120M60 346h76" {...soft} />
      <Path d="M150 556h196l-24 30H174z" {...ink} />
      <Path d="M190 556q58-58 116 0" {...ink} />
      <Path d="M248 498v-50" {...ink} />
      <Circle cx={248} cy={440} r={8} fill={palette.card} stroke={palette.ink} strokeWidth={2.2} />
      <Path d="M346 556l64-62" {...ink} />
      <Path d={`M-20 600${WAVE}`} {...ink} />
      <Path d={`M-20 632${WAVE}`} {...soft} />
      <Path d={`M-20 664${WAVE}`} {...soft} />
      <Path d={`M-20 696${WAVE}`} {...soft} />
    </Svg>
  );
}

/**
 * 宽屏时把表单放在右半边、左边画插画区；其他宽度直接返回表单。
 * form 是表单那一栏（自己负责滚动），footer 是贴底的服务器入口。
 */
export function AuthSplit({ form, footer }: { form: ReactNode; footer: ReactNode }) {
  const palette = usePalette();
  const { expanded, width, height } = useLayout();
  if (!expanded) {
    return (
      <>
        {form}
        {footer}
      </>
    );
  }
  return (
    <View style={styles.split}>
      {/* 高度按窗口固定：键盘弹出时页面变矮，插画区不跟着压扁（多出来的部分被键盘盖住） */}
      <View
        style={[
          styles.art,
          { width: Math.round(width * 0.473), height: height - space.l * 2, backgroundColor: palette.bg2 },
        ]}
      >
        <Art />
        <View style={styles.brand}>
          <Logo size={40} />
          <Text style={{ fontSize: 17, fontWeight: "700", letterSpacing: -0.17, color: palette.ink }}>
            BetterTavern
          </Text>
        </View>
        <Text style={[styles.caption, { color: palette.ink }]}>
          导入一张角色卡，{"\n"}用第一人称把故事写下去。
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {form}
        {footer}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: "row", alignItems: "flex-start" },
  art: { margin: space.l, borderRadius: radius.sheet, overflow: "hidden" },
  brand: {
    position: "absolute",
    top: 32,
    left: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
  },
  caption: {
    position: "absolute",
    left: 32,
    right: 32,
    bottom: 32,
    fontSize: 22,
    lineHeight: 34,
    fontWeight: "600",
    letterSpacing: -0.22,
  },
});
