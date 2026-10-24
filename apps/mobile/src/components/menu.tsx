/**
 * 面板里的菜单和表面（漫画风）。页面经 ui.tsx 引用。
 *
 * 菜单是白底 2.5 墨线的格子（圆角 14），行高 54，行之间一道 1.5 的浅灰线；删除的一行是红字。
 */

import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { comicRadius, comicStroke, useComic } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";

/** 面板里的一组菜单：白底墨线的格子 */
export function MenuGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useComic();
  const rows = Children.toArray(children).filter((child) => isValidElement(child));
  return (
    <View style={[styles.menuGroup, { backgroundColor: c.paper, borderColor: c.ink }, style]}>
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 ? <View style={{ height: comicStroke.chip, backgroundColor: c.grey2 }} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** 菜单里的一行：按下换成灰底 */
export function MenuItem({
  icon,
  label,
  onPress,
  danger,
  disabled,
  meta,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** 右端一行浅色说明（“还能 3 次”） */
  meta?: string;
  /** 暂时不能用：变淡，点了没反应 */
  disabled?: boolean;
}) {
  const c = useComic();
  const color = disabled ? c.mut : danger ? c.err : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? c.grey : "transparent" }]}
    >
      <Icon name={icon} color={color} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15.5, lineHeight: 22, fontWeight: "600", color }}>
        {label}
      </Text>
      {meta ? <Text style={{ fontSize: 13.5, color: c.mut }}>{meta}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menuGroup: { borderRadius: comicRadius.menu, borderWidth: comicStroke.frame, overflow: "hidden" },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 54,
    paddingHorizontal: 16,
  },
});
