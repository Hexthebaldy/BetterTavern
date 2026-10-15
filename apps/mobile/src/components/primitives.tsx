/**
 * 基本部件：页面容器、加载、文字、按钮、分组卡与列表行、分区标题。页面经 ui.tsx 引用。
 */

import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useLayout } from "../hooks/useLayout.ts";
import { font, onColor, radius, size, space, type, usePalette } from "../theme/index.ts";
import { pane } from "../theme/layout.ts";
import { Icon, type IconName } from "./icons.tsx";

// ---- 页面 -------------------------------------------------------------------------------

/** 内容已经放在一栏里（平板设置两栏的详情区）：页面不再自己居中限宽 */
export const InColumnContext = createContext(false);

/**
 * 平板（中屏、宽屏）上把页面内容收进居中的一栏：给 ScrollView 的 contentContainerStyle 用。
 * 手机上、或者已经在一栏里时返回 null。maxWidth 传 null 表示这一页不限宽。
 */
export function useColumnStyle(maxWidth: number | null = pane.readable): ViewStyle | null {
  const { compact } = useLayout();
  const inColumn = useContext(InColumnContext);
  if (compact || inColumn || maxWidth === null) return null;
  return { width: "100%", maxWidth, alignSelf: "center" };
}

export function Page({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  header,
  bottomSpace = 56,
  maxWidth = pane.readable,
  overlay,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** 固定在顶上、不随内容滚动的页头 */
  header?: ReactNode;
  /** 内容底部留白；标签页要让出浮动 Tab 栏（useTabBarSpace） */
  bottomSpace?: number;
  /** 平板上内容收进居中的一栏，最宽多少（默认 640）；null 不限宽 */
  maxWidth?: number | null;
  /** 盖在滚动内容上面、不随它滚动的东西（宽屏设置的右栏） */
  overlay?: ReactNode;
}) {
  const palette = usePalette();
  const column = useColumnStyle(maxWidth);
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingBottom: bottomSpace }, column, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={palette.mut} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {overlay}
    </View>
  );
}

/** 整页居中的状态 */
export function Centered({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return <View style={[styles.centered, { backgroundColor: palette.bg }, style]}>{children}</View>;
}

/** 三个圆点：通用加载。依次加深，表示“在动”，不代表进度 */
export function Dots({ color, cell = 6, gap = 4 }: { color?: string; cell?: number; gap?: number }) {
  const palette = usePalette();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => (s + 1) % 3), 320);
    return () => clearInterval(timer);
  }, []);
  const levels = [1, 0.4, 0.15];
  return (
    <View style={{ flexDirection: "row", gap }} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: cell,
            height: cell,
            borderRadius: cell / 2,
            backgroundColor: color ?? palette.ink,
            opacity: levels[(i - step + 3) % 3],
          }}
        />
      ))}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const palette = usePalette();
  return (
    <Centered>
      <View
        style={[styles.loadingPill, { backgroundColor: palette.bg2 }]}
        accessibilityRole="progressbar"
        accessibilityLabel={label ?? "加载中"}
      >
        <Dots />
        {label ? <Text style={{ fontSize: 13, color: palette.mut }}>{label}</Text> : null}
      </View>
    </Centered>
  );
}

/** 骨架屏的一条（圆头） */
export function SkeletonLine({
  width = "100%",
  height = 12,
  strong,
}: {
  width?: ViewStyle["width"];
  height?: number;
  strong?: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      style={{ width, height, borderRadius: height / 2, backgroundColor: strong ? palette.bg3 : palette.bg2 }}
    />
  );
}

// ---- 文字 -------------------------------------------------------------------------------

type TextProps = {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
};

export function Title({ children, style, numberOfLines }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      style={[type.title, { color: palette.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Heading({ children, style, numberOfLines }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      style={[type.rowTitle, { color: palette.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Body({ children, style, numberOfLines, selectable }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[type.body, { color: palette.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, style, numberOfLines }: TextProps) {
  const palette = usePalette();
  return (
    <Text numberOfLines={numberOfLines} style={[type.caption, { color: palette.mut }, style]}>
      {children}
    </Text>
  );
}

/** 等宽元信息：时间、计数、Key 尾号、上下文窗口 */
export function Mono({ children, style, numberOfLines, selectable }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[type.meta, { fontFamily: font.mono, color: palette.mut }, style]}
    >
      {children}
    </Text>
  );
}

// ---- 按钮 -------------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "dangerSolid";

/**
 * 胶囊按钮，高 52。推进流程的主按钮用 between + trailingIcon：文字靠左，右侧嵌一个 36 的半透明圆放箭头。
 * 按下缩到 97% 并加深一档；禁用不透明度 0.3。
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  icon,
  trailingIcon,
  between,
  onGrey,
  style,
  accessibilityHint,
  accessibilityLabel,
  children,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  /** 文字前的图标 */
  icon?: IconName;
  /** 文字后的图标；between 时放进右侧的半透明圆里 */
  trailingIcon?: IconName;
  /** 文字靠左、图标靠右（推进流程时像在翻下一页） */
  between?: boolean;
  /** 放在灰卡上：次要按钮改用白色 card 底 */
  onGrey?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  /** 替换文字部分（比如两行的按钮） */
  children?: ReactNode;
}) {
  const palette = usePalette();
  const inactive = !!disabled || !!busy;
  const look: Record<ButtonVariant, { bg: string; fg: string; pressed: string }> = {
    primary: { bg: palette.pri, fg: palette.onPri, pressed: palette.ink2 },
    secondary: { bg: onGrey ? palette.card : palette.bg2, fg: palette.ink, pressed: palette.bg3 },
    text: { bg: "transparent", fg: palette.acc, pressed: palette.bg2 },
    danger: { bg: palette.errBg, fg: palette.err, pressed: palette.errBg },
    dangerSolid: { bg: palette.err, fg: onColor, pressed: palette.err },
  };
  const c = look[variant];
  const arrowInCircle = between && trailingIcon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "text" && styles.textButton,
        between && styles.between,
        arrowInCircle ? styles.withArrow : null,
        {
          backgroundColor: pressed && !inactive ? c.pressed : c.bg,
          opacity: disabled && !busy ? 0.3 : 1,
          transform: [{ scale: pressed && !inactive ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <Dots color={c.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={c.fg} /> : null}
          {children ?? <Text style={[type.button, { color: c.fg }]}>{label}</Text>}
          {arrowInCircle ? (
            <View
              style={[
                styles.arrow,
                { backgroundColor: variant === "primary" ? palette.arrowBg : palette.bg3 },
              ]}
            >
              <Icon name={trailingIcon} size={18} color={c.fg} />
            </View>
          ) : trailingIcon ? (
            <Icon name={trailingIcon} size={20} color={c.fg} />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export type IconButtonTone = "grey" | "plain" | "card";

/**
 * 圆形图标按钮。默认是 40 的灰色圆底（导航按钮），热区仍是 44。
 * plain 透明底（输入框里的显示密码）；card 白底加投影（叠在封面图上）。
 */
export function IconButton({
  ref,
  icon,
  label,
  onPress,
  color,
  size: iconSize = 22,
  diameter = size.navButton,
  tone = "grey",
  disabled,
  badge,
  style,
}: {
  /** 量按钮位置用（平板上贴着按钮弹出的菜单） */
  ref?: Ref<View>;
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  diameter?: number;
  tone?: IconButtonTone;
  disabled?: boolean;
  /** 右上角的蓝色小圆点 */
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const bg = tone === "grey" ? palette.bg2 : tone === "card" ? palette.card : "transparent";
  const slop = Math.max(0, (size.touch - diameter) / 2);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={slop}
      style={({ pressed }) => [
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? (tone === "plain" ? palette.bg2 : palette.bg3) : bg,
          opacity: disabled ? 0.3 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        tone === "card" ? { boxShadow: palette.shadowButton } : null,
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} color={color ?? palette.ink} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: palette.acc, borderColor: palette.bg }]} />
      ) : null}
    </Pressable>
  );
}

// ---- 分组卡与列表行 ------------------------------------------------------------------------

/**
 * 分组卡：浅灰圆角卡片里放几行，行之间用页面底色的细线隔开（不画外框）。
 * inset 是分隔线左边的缩进（行首有 40 的图标时是 68）。
 */
export function Group({
  children,
  inset = 68,
  style,
}: {
  children: ReactNode;
  inset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const rows = Children.toArray(children).filter((c) => isValidElement(c));
  return (
    <View style={[styles.group, { backgroundColor: palette.bg2 }, style]}>
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 ? <View style={[styles.sep, { backgroundColor: palette.bg, marginLeft: inset }]} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** 列表行左边的 40 圆形图标格（在灰卡上是白底） */
export function RowIcon({ name, tone }: { name: IconName; tone?: "ink" | "acc" }) {
  const palette = usePalette();
  const bg = tone === "ink" ? palette.ink : tone === "acc" ? palette.accBg : palette.card;
  const fg = tone === "ink" ? palette.bg : tone === "acc" ? palette.acc : palette.ink;
  return (
    <View style={[styles.rowIcon, { backgroundColor: bg }]}>
      <Icon name={name} size={20} color={fg} />
    </View>
  );
}

/** 分组卡里的一行；按下时底色加深一档 */
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
  /** 两栏页面里右栏正打开着这一项：白底加 2px 蓝色内描边 */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
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
        { backgroundColor: pressed ? palette.bg3 : "transparent" },
        selected
          ? [
              styles.rowSelected,
              { backgroundColor: palette.card, boxShadow: `inset 0 0 0 2px ${palette.acc}` },
            ]
          : null,
        style,
      ]}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[
            styles.rowTitle,
            { color: palette.ink },
            mono ? { fontFamily: font.mono, fontSize: 15 } : null,
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={[styles.rowSubtitle, { color: subtitleColor ?? palette.mut }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {showChevron ? <Icon name="chevronRight" size={18} color={palette.mut} /> : null}
    </Pressable>
  );
}

/** 分区标题：19/26 粗体，右边一行浅色说明；标题下不画线 */
export function SectionHeader({
  title,
  meta,
  style,
}: {
  title: string;
  meta?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.section, style]}>
      <Text accessibilityRole="header" style={[type.section, { color: palette.ink, flex: 1 }]}>
        {title}
      </Text>
      {typeof meta === "string" ? <Text style={{ fontSize: 12.5, color: palette.mut }}>{meta}</Text> : meta}
    </View>
  );
}

/** 一组设置项上方的小标题 */
export function GroupLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View style={[styles.groupLabel, style]}>
      <Text style={{ fontSize: 13, lineHeight: 18, color: palette.mut }}>{children}</Text>
    </View>
  );
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return <View style={[{ height: 1, backgroundColor: palette.line }, style]} />;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.read },
  loadingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 36,
    paddingHorizontal: space.l,
    borderRadius: 18,
  },
  button: {
    minHeight: size.button,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
  },
  textButton: { minHeight: size.touch, paddingHorizontal: space.m },
  between: { justifyContent: "space-between" },
  withArrow: { paddingLeft: space.page, paddingRight: space.s },
  arrow: {
    width: size.buttonArrow,
    height: size.buttonArrow,
    borderRadius: size.buttonArrow / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { position: "absolute", top: 1, right: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  group: { borderRadius: 26, overflow: "hidden" },
  sep: { height: 1.5, marginRight: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  /** 选中的行缩进 4 画成圆角块，内边距少 4，外面看总尺寸不变 */
  rowSelected: { margin: 4, paddingVertical: 6, paddingHorizontal: 10, minHeight: 56, borderRadius: 22 },
  rowTitle: { fontSize: 16, lineHeight: 22 },
  rowSubtitle: { fontSize: 12.5, lineHeight: 18, marginTop: 1 },
  section: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingTop: 26,
    paddingBottom: 10,
    paddingHorizontal: space.page,
    gap: space.m,
  },
  groupLabel: { paddingTop: 18, paddingBottom: space.s, paddingHorizontal: space.page },
});
