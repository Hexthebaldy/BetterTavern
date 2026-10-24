/**
 * 分组和列表行（漫画风）：白底 2.5 墨线的格子里放几行，行之间一道 1.5 的浅灰线。页面经 ui.tsx 引用。
 * 行按下时换成灰底；两栏页面左栏选中的一行是浅蓝底、左边一道 3 的蓝线。
 */

import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { comicStroke, ctype, font, space, useComic } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";

/** 分组：圆角 14 的白格子，行之间一道浅灰线（通栏） */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useComic();
  const rows = Children.toArray(children).filter((child) => isValidElement(child));
  return (
    <View style={[styles.group, { backgroundColor: c.paper, borderColor: c.ink }, style]}>
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 ? <View style={[styles.sep, { backgroundColor: c.grey2 }]} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** 列表行左边的 40 图标方块：灰底墨线；ink 是墨底，acc 是蓝底 */
export function RowIcon({ name, tone }: { name: IconName; tone?: "ink" | "acc" }) {
  const c = useComic();
  const bg = tone === "ink" ? c.ink : tone === "acc" ? c.acc : c.grey;
  const fg = tone === "ink" ? c.paper : tone === "acc" ? c.onAcc : c.ink;
  return (
    <View style={[styles.rowIcon, { backgroundColor: bg, borderColor: c.ink }]}>
      <Icon name={name} size={20} color={fg} />
    </View>
  );
}

/** 分组里的一行；按下时换成灰底 */
export function ListRow({
  title,
  subtitle,
  subtitleColor,
  leading,
  trailing,
  onPress,
  onLongPress,
  chevron,
  mono,
  selected,
  danger,
  detail,
  style,
}: {
  title: string;
  subtitle?: string;
  subtitleColor?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** 默认可点的行显示右箭头 */
  chevron?: boolean;
  /** 标题用等宽字（模型名之类） */
  mono?: boolean;
  /** 两栏页面里右栏正打开着这一项：浅蓝底，左边一道蓝线 */
  selected?: boolean;
  /** 红字（删除、退出这一类） */
  danger?: boolean;
  /** 标题下面自己画的一行（代替 subtitle） */
  detail?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  const showChevron = chevron ?? !!onPress;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={selected ? { selected } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: selected ? c.selected : pressed ? c.grey : "transparent" },
        selected ? { boxShadow: `inset 3px 0 0 ${c.acc}` } : null,
        style,
      ]}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[
            ctype.rowTitle,
            { color: danger ? c.err : c.ink },
            mono ? { fontFamily: font.monoMedium, fontSize: 15, fontWeight: "normal" } : null,
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={[styles.rowSubtitle, { color: subtitleColor ?? c.mut }]}>
            {subtitle}
          </Text>
        ) : null}
        {detail}
      </View>
      {trailing}
      {showChevron ? <Icon name="chevronRight" size={18} color={c.mut} /> : null}
    </Pressable>
  );
}

/** 分区标题：粗体，右边一行浅色说明 */
export function SectionHeader({
  title,
  meta,
  style,
}: {
  title: string;
  meta?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  return (
    <View style={[styles.section, style]}>
      <Text accessibilityRole="header" style={[ctype.section, { color: c.ink, flex: 1 }]}>
        {title}
      </Text>
      {typeof meta === "string" ? (
        <Text style={{ fontFamily: font.monoMedium, fontSize: 12, color: c.mut }}>{meta}</Text>
      ) : (
        meta
      )}
    </View>
  );
}

/** 一组设置项上方的小标题 */
export function GroupLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useComic();
  return (
    <View style={[styles.groupLabel, style]}>
      <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "700", color: c.mut }}>{children}</Text>
    </View>
  );
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useComic();
  return <View style={[{ height: comicStroke.chip, backgroundColor: c.grey2 }, style]} />;
}

const styles = StyleSheet.create({
  group: { borderWidth: comicStroke.frame, borderRadius: 14, overflow: "hidden" },
  sep: { height: comicStroke.chip },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 60,
    paddingVertical: 9,
    paddingHorizontal: space.m,
  },
  rowSubtitle: { fontSize: 12.5, lineHeight: 18, marginTop: 1 },
  section: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingTop: 22,
    paddingBottom: 10,
    paddingHorizontal: 20,
    gap: space.m,
  },
  groupLabel: { paddingTop: 18, paddingBottom: space.s, paddingHorizontal: 20 + space.xs },
});
