/**
 * 浮起的面板（Sheet）和面板里的菜单。页面经 ui.tsx 引用；对话框、浮条和 useOverlay() 在 overlay.tsx。
 *
 * 手机上是底部面板：四周离屏幕边缘 8，圆角 32，顶部一根 40×5 的拖拽条；点遮罩、下拉或 Android 返回键关闭。
 * 平板（中屏、宽屏）上按 theme/layout.ts 的 overlayPresentation 换形态，内容不变：
 * - kind="choice"（默认：服务器、外观、编辑密钥……）→ 居中对话框：宽 ≤ 480，圆角 32，没有拖拽条，右上角关闭，点遮罩关闭；
 * - kind="menu"（阅读页“更多”）→ 贴着 anchor 按钮弹出：宽 340，圆角 28，右边缘和按钮对齐，底边在按钮
 *   （或 above）的顶边上方 8，上面放不下就放到按钮下方；不加遮罩，点外面关闭；量不到按钮的位置时退回居中对话框；
 * - full（世界状态）→ 从右侧滑出：宽 400，上、下、右各留 8，圆角 32，有遮罩。
 * 面板里有输入框时，键盘弹出后面板跟着浮到键盘上方（useKeyboardLift），输入框不会被盖住。
 * 有面板开着时，useOverlay() 的对话框画在最上面那个面板的 Modal 里（iOS 不能在 Modal 之上再从根上弹 Modal）。
 * 面板的 Modal 什么时候挂上、拿掉由 useGatedModal 决定（gatedModal.ts）：iOS 上要等别的 Modal 被收回才挂上，
 * 关闭时播完收起动画、等 iOS 确认收回才拿掉。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ModalProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { overlayPresentation, pane, popoverFrame, type OverlayKind } from "@bettertavern/design/layout";

import { useKeyboardLift } from "../hooks/useKeyboardLift.ts";
import { useLayout } from "../hooks/useLayout.ts";
import { BaseSurface, radius, space, useIsDark, usePalette } from "../theme/index.ts";
import { useGatedModal } from "./gatedModal.ts";
import { Icon, type IconName } from "./icons.tsx";
import { IconButton } from "./primitives.tsx";

/** iOS 的 Modal 默认只支持竖屏：iPad 横着时打开会被转回竖屏，所以所有方向都要列上（手机仍受 Info.plist 限制） */
export const MODAL_ORIENTATIONS: ModalProps["supportedOrientations"] = [
  "portrait",
  "portrait-upside-down",
  "landscape",
  "landscape-left",
  "landscape-right",
];

// ---- 面板里画对话框的位置 ------------------------------------------------------------------

const SHEET_OPEN_MS = 220;
const SHEET_CLOSE_MS = 180;

/** 打开着的面板（最上面的那个）里画对话框的位置；由 overlay.tsx 的 OverlayProvider 提供 */
export type Outlets = {
  top: number | null;
  register: (id: number) => void;
  unregister: (id: number) => void;
  renderDialog: (inline: boolean) => ReactNode;
};

export const OutletContext = createContext<Outlets | null>(null);
let nextOutletId = 1;

/** 面板打开时登记自己；对话框弹在最上面那个打开着的面板里（面板一开始关就撤销，也不再画对话框） */
function OverlayOutlet({ active }: { active: boolean }) {
  const outlets = useContext(OutletContext);
  const [id] = useState(() => nextOutletId++);
  const register = outlets?.register;
  const unregister = outlets?.unregister;
  useEffect(() => {
    if (!active || !register || !unregister) return;
    register(id);
    return () => unregister(id);
  }, [active, id, register, unregister]);
  return outlets && active && outlets.top === id ? <>{outlets.renderDialog(true)}</> : null;
}

// ---- 面板 -------------------------------------------------------------------------------

type Presentation = "sheet" | "dialog" | "popover" | "side";
type Rect = { x: number; y: number; width: number; height: number };
/** 弹出菜单贴着的按钮，以及菜单底边不能低于的 y */
type Anchored = { trigger: Rect; bottom: number };
/** 菜单的高度还没量出来时先按这个估计（阅读页“更多”大约这么高） */
const POPOVER_ESTIMATE = 380;

/** 量出 ref 在窗口里的位置；量不到（还没布局、已经卸载）给 null */
function measure(ref: RefObject<View | null> | undefined): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  return new Promise((resolve) => {
    const node = ref?.current;
    if (!node) {
      resolve(null);
      return;
    }
    node.measureInWindow((x, y, width, height) =>
      resolve(width > 0 || height > 0 ? { x, y, width, height } : null),
    );
  });
}

export function Sheet({
  visible,
  onClose,
  title,
  header,
  full,
  kind = "choice",
  anchor,
  above,
  children,
  style,
}: {
  visible: boolean;
  onClose: () => void;
  /** 默认的标题行（标题加关闭按钮） */
  title?: string;
  /** 自定义标题区（替换默认标题行，仍然可以下拉关闭） */
  header?: ReactNode;
  /** 从状态栏下方一直到底（世界状态面板）；平板上从右侧滑出 */
  full?: boolean;
  /** 平板上换成什么：choice 居中对话框，menu 贴着 anchor 弹出 */
  kind?: OverlayKind;
  /** 弹出菜单贴着的按钮 */
  anchor?: RefObject<View | null>;
  /** 弹出菜单的底边放在它的顶边上方 8；不传就放在按钮上方 */
  above?: RefObject<View | null>;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { size, width: windowWidth, height: windowHeight } = useLayout();
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const { height: keyboardHeight, lift } = useKeyboardLift();
  // 弹出菜单贴着的按钮：undefined 还在量，null 量不到（退回对话框）
  const [placed, setPlaced] = useState<Anchored | null | undefined>(undefined);
  const [popHeight, setPopHeight] = useState(POPOVER_ESTIMATE);

  const wanted: Presentation = size === "compact" ? "sheet" : full ? "side" : overlayPresentation(kind, size);
  const presentation: Presentation = wanted === "popover" && placed === null ? "dialog" : wanted;

  const animateOut = useCallback(
    (done: () => void) =>
      Animated.timing(progress, { toValue: 0, duration: SHEET_CLOSE_MS, useNativeDriver: true }).start(() =>
        done(),
      ),
    [progress],
  );
  const modal = useGatedModal(visible, "sheet", animateOut);

  // Modal 挂上之后才播进场动画（iOS 上可能要先等别的 Modal 被收回）
  useEffect(() => {
    if (!modal.shown) return;
    drag.setValue(0);
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: SHEET_OPEN_MS, useNativeDriver: true }).start();
  }, [modal.shown, progress, drag]);

  // 打开时、窗口尺寸变了时重新量按钮的位置
  useEffect(() => {
    if (!visible || wanted !== "popover") return;
    let alive = true;
    void (async () => {
      const trigger = await measure(anchor);
      const floor = above ? await measure(above) : null;
      if (!alive) return;
      if (!trigger) {
        setPlaced(null);
        return;
      }
      setPlaced({ trigger, bottom: floor ? floor.y : trigger.y });
    })();
    return () => {
      alive = false;
    };
  }, [visible, wanted, anchor, above, windowWidth, windowHeight]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 80 || g.vy > 1) closeRef.current();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [drag],
  );

  if (!modal.mounted) return null;

  const titleRow = title ? (
    <View style={styles.sheetTitleRow}>
      <Text accessibilityRole="header" style={[styles.sheetTitle, { color: palette.ink }]}>
        {title}
      </Text>
      <IconButton icon="close" label="关闭" size={18} diameter={36} onPress={onClose} />
    </View>
  ) : null;

  const scrim = (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: presentation === "popover" ? "transparent" : palette.scrim,
          opacity: progress,
        },
      ]}
    >
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="关闭" accessibilityRole="button" />
    </Animated.View>
  );

  let body: ReactNode;
  if (presentation === "sheet") {
    const translateY = Animated.add(
      progress.interpolate({ inputRange: [0, 1], outputRange: [1000, 0] }),
      drag,
    );
    body = (
      // 外层跟着键盘抬高（布局动画），里层负责进出场和下拉（原生动画），两种动画不放在同一个视图上
      <Animated.View
        style={[styles.host, { paddingTop: insets.top + space.s, paddingBottom: lift }]}
        pointerEvents="box-none"
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: palette.sheet,
              // 键盘弹出时贴着键盘，不再给 Home 指示条留位置
              paddingBottom: keyboardHeight > 0 ? space.l : Math.max(insets.bottom - space.s, space.l),
              transform: [{ translateY }],
            },
            full ? styles.sheetFull : null,
            style,
          ]}
        >
          <View {...pan.panHandlers}>
            <View style={[styles.handle, { backgroundColor: palette.line2 }]} />
            {header ?? titleRow ?? <View style={{ height: space.xs }} />}
          </View>
          {children}
        </Animated.View>
      </Animated.View>
    );
  } else if (presentation === "side") {
    body = (
      <View
        style={[styles.side, { top: insets.top + space.s, bottom: Math.max(insets.bottom, space.s) }]}
        pointerEvents="box-none"
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sidePanel,
            {
              backgroundColor: palette.sheet,
              transform: [
                {
                  translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [pane.world + 24, 0] }),
                },
              ],
            },
            style,
          ]}
        >
          {header ?? titleRow}
          {children}
        </Animated.View>
      </View>
    );
  } else if (presentation === "popover") {
    const frame = placed
      ? popoverFrame(
          placed.trigger,
          { width: windowWidth, height: windowHeight },
          placed.bottom,
          popHeight,
          insets.top + space.s,
        )
      : null;
    body = frame ? (
      <Animated.View
        accessibilityViewIsModal
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          setPopHeight((old) => (Math.abs(old - h) < 1 ? old : h));
        }}
        style={[
          styles.popover,
          {
            left: frame.left,
            top: frame.top,
            width: frame.width,
            backgroundColor: palette.sheet,
            boxShadow: palette.shadowFloat,
            opacity: progress,
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
          style,
        ]}
      >
        {header ?? titleRow}
        {children}
      </Animated.View>
    ) : null;
  } else {
    body = (
      <Animated.View
        style={[
          styles.dialogHost,
          { paddingTop: insets.top + space.l, paddingBottom: Animated.add(lift, space.l) },
        ]}
        pointerEvents="box-none"
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: palette.sheet,
              boxShadow: palette.shadowFloat,
              opacity: progress,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
            },
            style,
          ]}
        >
          {header ?? titleRow ?? (
            <View style={styles.dialogClose}>
              <IconButton icon="close" label="关闭" size={18} diameter={36} onPress={onClose} />
            </View>
          )}
          {children}
        </Animated.View>
      </Animated.View>
    );
  }

  return (
    <Modal
      transparent
      visible={modal.visible}
      animationType="none"
      onRequestClose={onClose}
      onDismiss={modal.onDismiss}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      <BaseSurface>
        {scrim}
        {body}
        <OverlayOutlet active={visible} />
      </BaseSurface>
    </Modal>
  );
}

// ---- 面板里的表面和菜单 ---------------------------------------------------------------------

type Surfaces = { inset: string; raised: string; fill: string; onFill: string };

const SurfacesContext = createContext<Surfaces | null>(null);

/**
 * 面板里再嵌一层的底色（深色下面板比页面亮，不能直接用 bg2）：
 * - inset：凹下去的分组（浅色 bg2，深色 bg）；raised：分组里选中的那一格（浅色白，深色 bg3）
 * - fill：直接放在面板上的灰色块，比如阅读页的选项、次要按钮（浅色 bg2，深色 bg3）
 * - onFill：fill 块里再嵌的小块，比如世界状态卡片里的图标圆、关系标签（面板的颜色）
 * 灰底的面板（平板上停靠和滑出的世界状态）用 PanelSurfaces 换成“灰底白卡”。
 */
export function useSheetSurfaces(): Surfaces {
  const palette = usePalette();
  const dark = useIsDark();
  const override = useContext(SurfacesContext);
  if (override) return override;
  return dark
    ? { inset: palette.bg, raised: palette.bg3, fill: palette.bg3, onFill: palette.sheet }
    : { inset: palette.bg2, raised: palette.card, fill: palette.bg2, onFill: palette.sheet };
}

/** 灰底（bg2）面板里的表面：卡片是白色 card，凹下去的分组是 bg3（深色 bg） */
export function PanelSurfaces({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const dark = useIsDark();
  const value = useMemo<Surfaces>(
    () =>
      dark
        ? { inset: palette.bg, raised: palette.bg3, fill: palette.card, onFill: palette.bg2 }
        : { inset: palette.bg3, raised: palette.card, fill: palette.card, onFill: palette.bg2 },
    [dark, palette],
  );
  return <SurfacesContext.Provider value={value}>{children}</SurfacesContext.Provider>;
}

/** 直接放在页面上的表面（阅读页故事流末尾的选项）：灰卡是 bg2，灰卡里的小圆是白色 card */
export function PageSurfaces({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const value = useMemo<Surfaces>(
    () => ({ inset: palette.bg2, raised: palette.card, fill: palette.bg2, onFill: palette.card }),
    [palette],
  );
  return <SurfacesContext.Provider value={value}>{children}</SurfacesContext.Provider>;
}

/** 面板里的一组菜单（凹下去的圆角卡片） */
export function MenuGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { inset } = useSheetSurfaces();
  return <View style={[styles.menuGroup, { backgroundColor: inset }, style]}>{children}</View>;
}

/** 面板里的一行菜单项 */
export function MenuItem({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** 暂时不能用：变淡，点了没反应 */
  disabled?: boolean;
}) {
  const palette = usePalette();
  const color = danger ? palette.err : palette.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        {
          backgroundColor: pressed ? palette.bg3 : "transparent",
          transform: [{ scale: pressed ? 0.98 : 1 }],
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Icon name={icon} color={color} />
      <Text style={{ fontSize: 16, lineHeight: 22, color }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" },
  sheet: {
    marginHorizontal: space.s,
    marginBottom: space.s,
    borderRadius: radius.sheet,
    overflow: "hidden",
  },
  /** 从状态栏下方一直到底：离状态栏 36 */
  sheetFull: { flex: 1, marginTop: space.xxl - space.s, paddingBottom: 0 },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 2.5, marginTop: 10 },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: space.m,
    paddingBottom: space.m,
    paddingLeft: space.page - 4,
    paddingRight: space.l,
  },
  sheetTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: "700" },
  dialogHost: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space.l,
  },
  dialog: {
    width: "100%",
    maxWidth: pane.dialog,
    maxHeight: "100%",
    borderRadius: radius.sheet,
    paddingBottom: space.l,
    overflow: "hidden",
  },
  dialogClose: { alignItems: "flex-end", paddingTop: space.m, paddingRight: space.l },
  popover: {
    position: "absolute",
    borderRadius: radius.group,
    paddingTop: space.xs,
    paddingBottom: space.s,
    overflow: "hidden",
  },
  side: { position: "absolute", right: space.s, width: pane.world },
  sidePanel: { flex: 1, borderRadius: radius.sheet, overflow: "hidden" },
  menuGroup: { borderRadius: 26, padding: space.xs },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 56,
    paddingHorizontal: space.l,
    borderRadius: radius.card,
  },
});
