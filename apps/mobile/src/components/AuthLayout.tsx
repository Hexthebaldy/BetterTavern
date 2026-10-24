/**
 * 登录、注册在平板上的版式（docs/design/comic/tablet/README.md 的 16–17）。手机上原样不动。
 *
 * - 宽屏：左右分栏。左边一格（左 16、上 32、下 16，宽 560，2.5 墨线，圆角 16，灰网点底）放网页登录页那张
 *   没有字的桌面（AuthDesk.tsx），对读屏隐藏；注册页是“刚开始”的桌面。右边是表单，宽 400，在右半边居中，
 *   顶上是 Logo 和名字（AuthBrand），服务器入口贴在右半边底部。
 * - 中屏：表单宽 440，居中，服务器入口贴底。服务器选择是居中对话框（Sheet 在平板上自己换形态）。
 */

import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useLayout } from "../hooks/useLayout.ts";
import { comicRadius, comicStroke, space, useComic } from "../theme/index.ts";
import { AuthDesk } from "./AuthDesk.tsx";
import type { DeskStage } from "./AuthDeskSheets.tsx";
import { Halftone } from "./Halftone.tsx";
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

/** 宽屏时表单顶上的 Logo 和名字（左边的桌面上一个字也没有） */
export function AuthBrand() {
  const c = useComic();
  return (
    <View style={styles.brand}>
      <Logo size={36} />
      <Text style={[styles.brandName, { color: c.ink }]}>BetterTavern</Text>
    </View>
  );
}

/**
 * 宽屏时把表单放在右半边、左边放桌面；其他宽度直接返回表单。
 * form 是表单那一栏（自己负责滚动），footer 是贴底的服务器入口，desk 是桌面画成哪个样子（注册页是 start）。
 */
export function AuthSplit({ form, footer, desk = "full" }: { form: ReactNode; footer?: ReactNode; desk?: DeskStage }) {
  const c = useComic();
  const { expanded, height } = useLayout();
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
      {/* 高度按窗口固定：键盘弹出时页面变矮，桌面不跟着压扁（多出来的部分被键盘盖住） */}
      <Halftone
        tone="grey"
        style={[styles.desk, { height: height - DESK_TOP - DESK_BOTTOM, borderColor: c.ink }]}
      >
        <AuthDesk stage={desk} />
      </Halftone>
      <View style={{ flex: 1 }}>
        {form}
        {footer}
      </View>
    </View>
  );
}

const DESK_TOP = 32;
const DESK_BOTTOM = space.l;

const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: "row", alignItems: "flex-start" },
  desk: {
    width: 560,
    marginTop: DESK_TOP,
    marginLeft: space.l,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.panel,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: space.m },
  brandName: { fontSize: 20, fontWeight: "900", letterSpacing: -0.2 },
});
