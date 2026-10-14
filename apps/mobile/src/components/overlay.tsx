/**
 * 浮层：底部面板、对话框、墨色浮条，以及给页面用的 useOverlay()（确认、输入、菜单、浮条）。
 *
 * 底部面板浮起，四周离屏幕边缘 8，圆角 32，顶部一根 40×5 的拖拽条；点遮罩、下拉或 Android 返回键关闭。
 * 对话框是居中的白色圆角卡片，上方一个圆形图标写清后果；删除用红色，揭示秘密之类的提醒用琥珀色。
 * 有底部面板开着时，对话框画在最上面那个面板的 Modal 里（iOS 不能在 Modal 之上再从根上弹 Modal）。
 * 墨色胶囊浮条贴着标签栏上方浮起，3 秒后自动消失（带操作的多留一会儿）。
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
} from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, space, useIsDark, usePalette } from "../theme/index.ts";
import { tabBarTop } from "./bars.tsx";
import { Dialog, type DialogTone } from "./dialog.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { IconButton } from "./primitives.tsx";

// ---- 底部面板 ----------------------------------------------------------------------------

/** 最近一次面板开始收起的时间：iOS 上一个 Modal 还没收完就弹下一个会弹不出来，对话框要等它收完 */
let sheetClosingAt = 0;
const SHEET_CLOSE_MS = 180;

export function Sheet({
  visible,
  onClose,
  title,
  header,
  full,
  children,
  style,
}: {
  visible: boolean;
  onClose: () => void;
  /** 默认的标题行（标题加关闭按钮） */
  title?: string;
  /** 自定义标题区（替换默认标题行，仍然可以下拉关闭） */
  header?: ReactNode;
  /** 从状态栏下方一直到底（世界状态面板） */
  full?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const shown = useRef(false);

  useEffect(() => {
    if (visible) {
      shown.current = true;
      setMounted(true);
      drag.setValue(0);
      Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else if (shown.current) {
      shown.current = false;
      sheetClosingAt = Date.now();
      Animated.timing(progress, { toValue: 0, duration: SHEET_CLOSE_MS, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setMounted(false);
        },
      );
    }
  }, [visible, progress, drag]);

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

  if (!mounted) return null;
  const translateY = Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [1000, 0] }), drag);
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim, opacity: progress }]}>
        <Pressable
          style={{ flex: 1 }}
          onPress={onClose}
          accessibilityLabel="关闭"
          accessibilityRole="button"
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.sheetHost}
        pointerEvents="box-none"
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              bottom: space.s,
              backgroundColor: palette.sheet,
              paddingBottom: Math.max(insets.bottom - space.s, space.l),
              transform: [{ translateY }],
            },
            full ? { top: insets.top + space.xxl, paddingBottom: 0 } : null,
            style,
          ]}
        >
          <View {...pan.panHandlers}>
            <View style={[styles.handle, { backgroundColor: palette.line2 }]} />
            {header ??
              (title ? (
                <View style={styles.sheetTitleRow}>
                  <Text accessibilityRole="header" style={[styles.sheetTitle, { color: palette.ink }]}>
                    {title}
                  </Text>
                  <IconButton icon="close" label="关闭" size={18} diameter={36} onPress={onClose} />
                </View>
              ) : (
                <View style={{ height: space.xs }} />
              ))}
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
      <OverlayOutlet active={visible} />
    </Modal>
  );
}

/**
 * 面板里再嵌一层的底色（深色下面板比页面亮，不能直接用 bg2）：
 * - inset：凹下去的分组（浅色 bg2，深色 bg）；raised：分组里选中的那一格（浅色白，深色 bg3）
 * - fill：直接放在面板上的灰色块，比如阅读页的选项、次要按钮（浅色 bg2，深色 bg3）
 */
export function useSheetSurfaces(): { inset: string; raised: string; fill: string } {
  const palette = usePalette();
  const dark = useIsDark();
  return dark
    ? { inset: palette.bg, raised: palette.bg3, fill: palette.bg3 }
    : { inset: palette.bg2, raised: palette.card, fill: palette.bg2 };
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
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const palette = usePalette();
  const color = danger ? palette.err : palette.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        {
          backgroundColor: pressed ? palette.bg3 : "transparent",
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Icon name={icon} color={color} />
      <Text style={{ fontSize: 16, lineHeight: 22, color }}>{label}</Text>
    </Pressable>
  );
}

// ---- useOverlay -------------------------------------------------------------------------

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: DialogTone;
  icon?: IconName;
};

export type PromptOptions = {
  title: string;
  message?: string;
  label: string;
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  confirmLabel?: string;
};

export type MenuOptions = {
  title?: string;
  items: { key: string; label: string; icon: IconName; danger?: boolean }[];
};

export type ToastOptions = {
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
};

type Overlay = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** 输入一行文字；取消或没填返回 null */
  prompt: (options: PromptOptions) => Promise<string | null>;
  /** 底部菜单（长按列表行、详情页的“更多”）；返回选中项的 key */
  menu: (options: MenuOptions) => Promise<string | null>;
  toast: (message: string, options?: ToastOptions) => void;
};

type Request =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (text: string | null) => void }
  | { kind: "menu"; options: MenuOptions; resolve: (key: string | null) => void };

const OverlayContext = createContext<Overlay | null>(null);

/** 打开着的底部面板（最上面的那个）里画对话框的位置 */
type Outlets = {
  top: number | null;
  register: (id: number) => void;
  unregister: (id: number) => void;
  renderDialog: (inline: boolean) => ReactNode;
};

const OutletContext = createContext<Outlets | null>(null);
let nextOutletId = 1;

/** 面板打开时登记自己；对话框弹在最上面那个打开着的面板里 */
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
  return outlets && outlets.top === id ? <>{outlets.renderDialog(true)}</> : null;
}

export function useOverlay(): Overlay {
  const value = useContext(OverlayContext);
  if (!value) throw new Error("useOverlay 必须在 OverlayProvider 里使用");
  return value;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [toastState, setToast] = useState<{ id: number; message: string; options: ToastOptions } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [outletStack, setOutletStack] = useState<number[]>([]);
  const current = useRef<Request | null>(null);
  const toastId = useRef(0);

  const settle = useCallback((value: boolean | string | null) => {
    const r = current.current;
    current.current = null;
    setRequest(null);
    if (r?.kind === "confirm") r.resolve(value === true);
    else if (r?.kind === "prompt") r.resolve(typeof value === "string" ? value : null);
    else if (r?.kind === "menu") r.resolve(typeof value === "string" ? value : null);
  }, []);

  const open = useCallback(
    (next: Request) => {
      settle(null); // 同时只有一个：新的请求把旧的当作取消
      const wait = next.kind === "menu" ? 0 : Math.max(0, sheetClosingAt + SHEET_CLOSE_MS + 120 - Date.now());
      setTimeout(() => {
        current.current = next;
        if (next.kind === "prompt") setDraft(next.options.initial ?? "");
        setRequest(next);
      }, wait);
    },
    [settle],
  );

  const overlay = useMemo<Overlay>(
    () => ({
      confirm: (options) => new Promise((resolve) => open({ kind: "confirm", options, resolve })),
      prompt: (options) => new Promise((resolve) => open({ kind: "prompt", options, resolve })),
      menu: (options) => new Promise((resolve) => open({ kind: "menu", options, resolve })),
      toast: (message, options = {}) => {
        toastId.current += 1;
        setToast({ id: toastId.current, message, options });
      },
    }),
    [open],
  );

  useEffect(() => {
    if (!toastState) return;
    const timer = setTimeout(() => setToast(null), toastState.options.onAction ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [toastState]);

  const confirmRequest = request?.kind === "confirm" ? request.options : null;
  const promptRequest = request?.kind === "prompt" ? request.options : null;
  const menuRequest = request?.kind === "menu" ? request.options : null;

  const renderDialog = useCallback(
    (inline: boolean): ReactNode => (
      <>
        {confirmRequest ? (
          <Dialog
            visible
            inline={inline}
            tone={confirmRequest.tone}
            icon={confirmRequest.icon}
            title={confirmRequest.title}
            message={confirmRequest.message}
            cancelLabel={confirmRequest.cancelLabel}
            confirmLabel={confirmRequest.confirmLabel}
            onCancel={() => settle(false)}
            onConfirm={() => settle(true)}
          />
        ) : null}
        {promptRequest ? (
          <PromptDialog
            options={promptRequest}
            inline={inline}
            draft={draft}
            onDraft={setDraft}
            onSettle={settle}
          />
        ) : null}
      </>
    ),
    [confirmRequest, promptRequest, draft, settle],
  );

  const register = useCallback((id: number) => setOutletStack((stack) => [...stack, id]), []);
  const unregister = useCallback(
    (id: number) => setOutletStack((stack) => stack.filter((x) => x !== id)),
    [],
  );
  const top = outletStack.length > 0 ? (outletStack[outletStack.length - 1] ?? null) : null;
  const outlets = useMemo<Outlets>(
    () => ({ top, register, unregister, renderDialog }),
    [top, register, unregister, renderDialog],
  );

  return (
    <OverlayContext.Provider value={overlay}>
      <OutletContext.Provider value={outlets}>
        <View style={{ flex: 1 }}>
          {children}
          {toastState ? (
            <Toast
              key={toastState.id}
              message={toastState.message}
              options={toastState.options}
              onDone={() => setToast(null)}
            />
          ) : null}
        </View>
        {top === null ? renderDialog(false) : null}
        <MenuSheet options={menuRequest} onSettle={settle} />
      </OutletContext.Provider>
    </OverlayContext.Provider>
  );
}

function PromptDialog({
  options,
  inline,
  draft,
  onDraft,
  onSettle,
}: {
  options: PromptOptions;
  inline: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSettle: (value: string | null) => void;
}) {
  const palette = usePalette();
  const text = draft.trim();
  return (
    <Dialog
      visible
      inline={inline}
      title={options.title}
      message={options.message}
      confirmLabel={options.confirmLabel ?? "保存"}
      confirmDisabled={text.length === 0}
      onCancel={() => onSettle(null)}
      onConfirm={() => onSettle(text)}
    >
      <TextInput
        value={draft}
        onChangeText={onDraft}
        autoFocus
        maxLength={options.maxLength}
        placeholder={options.placeholder}
        placeholderTextColor={palette.mut}
        accessibilityLabel={options.label}
        returnKeyType="done"
        onSubmitEditing={() => text && onSettle(text)}
        style={[
          styles.promptInput,
          { color: palette.ink, backgroundColor: palette.bg2, boxShadow: `inset 0 0 0 2px ${palette.acc}` },
        ]}
      />
    </Dialog>
  );
}

function MenuSheet({
  options,
  onSettle,
}: {
  options: MenuOptions | null;
  onSettle: (key: string | null) => void;
}) {
  // 关闭时保留最后一次的内容，让收起动画里还有东西
  const last = useRef<MenuOptions | null>(null);
  if (options) last.current = options;
  const shown = options ?? last.current;
  return (
    <Sheet visible={options !== null} onClose={() => onSettle(null)} title={shown?.title}>
      <MenuGroup style={{ marginHorizontal: space.s }}>
        {shown?.items.map((item) => (
          <MenuItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            danger={item.danger}
            onPress={() => onSettle(item.key)}
          />
        ))}
      </MenuGroup>
    </Sheet>
  );
}

function Toast({ message, options, onDone }: { message: string; options: ToastOptions; onDone: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          bottom: tabBarTop(insets.bottom) + space.m,
          backgroundColor: palette.ink,
          boxShadow: palette.shadowFloat,
        },
      ]}
    >
      <Icon name={options.icon ?? "checkCircle"} size={18} color={palette.bg} />
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: palette.bg }} numberOfLines={2}>
        {message}
      </Text>
      {options.actionLabel && options.onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            options.onAction?.();
            onDone();
          }}
          style={[styles.toastAction, { backgroundColor: palette.arrowBg }]}
        >
          <Text style={{ fontSize: 14, fontWeight: "500", color: palette.bg }}>{options.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetHost: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" },
  sheet: {
    position: "absolute",
    left: space.s,
    right: space.s,
    borderRadius: radius.sheet,
    overflow: "hidden",
  },
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
  menuGroup: { borderRadius: 26, padding: space.xs },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 56,
    paddingHorizontal: space.l,
    borderRadius: radius.card,
  },
  promptInput: {
    alignSelf: "stretch",
    height: 52,
    borderRadius: radius.input,
    paddingHorizontal: space.l,
    fontSize: 16,
    marginTop: space.xs,
  },
  toast: {
    position: "absolute",
    left: space.page,
    right: space.page,
    minHeight: 52,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingLeft: 18,
    paddingRight: 6,
  },
  toastAction: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
