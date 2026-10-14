/**
 * 浮层：底部面板、对话框、墨色浮条，以及给页面用的 useOverlay()（确认、输入、菜单、浮条）。
 *
 * 底部面板顶边一道 2px 黑线代替拖拽条；点遮罩、下拉标题行或 Android 返回键关闭。
 * 对话框顶边 4px 色线写清后果；删除用红色，揭示秘密之类的提醒用琥珀色。
 * 有底部面板开着时，对话框画在最上面那个面板的 Modal 里（iOS 不能在 Modal 之上再从根上弹 Modal）。
 * 墨色浮条 3 秒后自动消失（带操作的多留一会儿）。
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

import { space, type, usePalette } from "../theme/index.ts";
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
  /** 占满导航栏以下的整屏 */
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
              backgroundColor: palette.bg,
              borderTopColor: palette.ink,
              paddingBottom: insets.bottom,
              transform: [{ translateY }],
            },
            full ? { top: insets.top + 4 } : null,
            style,
          ]}
        >
          <View {...pan.panHandlers}>
            {header ??
              (title ? (
                <View style={styles.sheetTitleRow}>
                  <Text accessibilityRole="header" style={[type.section, { color: palette.ink, flex: 1 }]}>
                    {title}
                  </Text>
                  <IconButton icon="close" label="关闭" onPress={onClose} style={{ marginRight: -10 }} />
                </View>
              ) : (
                <View style={{ height: space.s }} />
              ))}
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
      <OverlayOutlet active={visible} />
    </Modal>
  );
}

/** 面板里的一行菜单项 */
export function MenuItem({
  icon,
  label,
  onPress,
  danger,
  last,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const palette = usePalette();
  const color = danger ? palette.err : palette.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        { borderBottomColor: palette.line, backgroundColor: pressed ? palette.bg2 : "transparent" },
        last ? { borderBottomWidth: 0 } : null,
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
        style={[styles.promptInput, { color: palette.ink, borderColor: palette.ink }]}
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
      <View style={{ marginTop: shown?.title ? 0 : space.s }}>
        {shown?.items.map((item, i) => (
          <MenuItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            danger={item.danger}
            last={i === shown.items.length - 1}
            onPress={() => onSettle(item.key)}
          />
        ))}
      </View>
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
      style={[styles.toast, { bottom: insets.bottom + 50, backgroundColor: palette.ink }]}
    >
      <Icon name={options.icon ?? "check"} size={18} color={palette.bg} />
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
          style={styles.toastAction}
        >
          <Text style={{ fontSize: 14, fontWeight: "500", color: palette.bg }}>{options.actionLabel}</Text>
          <Icon name="arrowRight" size={16} color={palette.bg} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetHost: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: 2 },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: space.page,
    paddingBottom: space.m,
    paddingHorizontal: space.page,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 56,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  promptInput: { height: 52, borderWidth: 2, paddingHorizontal: 14, fontSize: 16, marginTop: space.xs },
  toast: {
    position: "absolute",
    left: 0,
    right: 0,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingLeft: space.page,
    paddingRight: space.s,
  },
  toastAction: { flexDirection: "row", alignItems: "center", gap: 4, height: 44, paddingHorizontal: space.m },
});
