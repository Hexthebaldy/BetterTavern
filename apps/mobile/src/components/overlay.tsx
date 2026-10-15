/**
 * 浮层：对话框、墨色浮条、菜单，以及给页面用的 useOverlay()（确认、输入、菜单、浮条）。面板本身在 sheet.tsx。
 *
 * 对话框是居中的白色圆角卡片（宽 ≤ 480），上方一个圆形图标写清后果；删除用红色，揭示秘密之类的提醒用琥珀色。
 * 有面板开着时，对话框画在最上面那个面板的 Modal 里（iOS 不能在 Modal 之上再从根上弹 Modal）。
 * 墨色胶囊浮条贴着标签栏上方浮起，3 秒后自动消失（带操作的多留一会儿）；平板上宽 ≤ 480，
 * 中屏在底部 Tab 栏上方居中，宽屏在内容区（x ≥ 124）底部居中。
 * 菜单在手机上是底部面板；平板上长按卡片时，卡片抬起（放大 3%，白底加投影），下方弹出宽 240 的菜单，背景加浅遮罩。
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
import { Animated, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLayout } from "../hooks/useLayout.ts";
import { BaseSurface, radius, space, useIsDark, usePalette } from "../theme/index.ts";
import { cardMenuFrame, toastFrame } from "../theme/layout.ts";
import { tabBarTop } from "./bars.tsx";
import { Dialog, type DialogTone } from "./dialog.tsx";
import { Icon, type IconName } from "./icons.tsx";
import {
  MenuGroup,
  MenuItem,
  MODAL_ORIENTATIONS,
  OutletContext,
  Sheet,
  sheetCloseWait,
  type Outlets,
} from "./sheet.tsx";

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
  /** 平板上：菜单贴着这张卡片弹出（手机上忽略，仍是底部面板） */
  anchor?: RefObject<View | null>;
  /** 平板上：抬起的卡片画成什么（通常就是卡片本身） */
  lifted?: ReactNode;
  /** 抬起的卡片的圆角，默认和故事卡片一样 24 */
  liftedRadius?: number;
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
      const wait = next.kind === "menu" ? 0 : sheetCloseWait();
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
        <Menu options={menuRequest} onSettle={settle} />
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

/** 手机上是底部面板；平板上有卡片可以贴就贴着卡片弹出，没有就是居中对话框 */
function Menu({
  options,
  onSettle,
}: {
  options: MenuOptions | null;
  onSettle: (key: string | null) => void;
}) {
  const { compact } = useLayout();
  // 量不到卡片位置时退回面板（平板上是居中对话框）
  const [unplaceable, setUnplaceable] = useState(false);
  useEffect(() => {
    if (options) setUnplaceable(false);
  }, [options]);
  if (!compact && options?.anchor && !unplaceable) {
    return <CardMenu options={options} onSettle={onSettle} onUnplaceable={() => setUnplaceable(true)} />;
  }
  return <MenuSheet options={options} onSettle={onSettle} />;
}

type Rect = { x: number; y: number; width: number; height: number };

const CARD_MENU_ITEM = 52;

/** 平板上长按卡片：卡片抬起（放大 3%，白底加投影），下方弹出宽 240 的菜单，背景加浅遮罩；点外面关闭 */
function CardMenu({
  options,
  onSettle,
  onUnplaceable,
}: {
  options: MenuOptions;
  onSettle: (key: string | null) => void;
  onUnplaceable: () => void;
}) {
  const palette = usePalette();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  const { width, height } = useLayout();
  const [card, setCard] = useState<Rect | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const node = options.anchor?.current;
    if (!node) {
      onUnplaceable();
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      if (w <= 0 || h <= 0) onUnplaceable();
      else setCard({ x, y, width: w, height: h });
    });
    // 只在打开时量一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  useEffect(() => {
    if (card) Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [card, progress]);

  if (!card) return null;
  const menuHeight = options.items.length * CARD_MENU_ITEM + space.s * 2;
  const frame = cardMenuFrame(card, { width, height }, menuHeight, insets.bottom);
  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={() => onSettle(null)}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      <BaseSurface>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? "rgba(0,0,0,0.4)" : "rgba(20,20,20,0.18)", opacity: progress },
          ]}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={() => onSettle(null)}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          />
        </Animated.View>
        {options.lifted ? (
          <Animated.View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[
              styles.lifted,
              {
                borderRadius: options.liftedRadius ?? radius.option,
                left: card.x,
                top: card.y,
                width: card.width,
                height: card.height,
                backgroundColor: palette.card,
                boxShadow: palette.shadowFloat,
                transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }],
              },
            ]}
          >
            {options.lifted}
          </Animated.View>
        ) : null}
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.cardMenu,
            {
              left: frame.left,
              top: frame.top,
              width: frame.width,
              backgroundColor: palette.card,
              boxShadow: palette.shadowFloat,
              opacity: progress,
            },
          ]}
        >
          {options.items.map((item) => (
            <MenuItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              danger={item.danger}
              onPress={() => onSettle(item.key)}
            />
          ))}
        </Animated.View>
      </BaseSurface>
    </Modal>
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
  const { size, width } = useLayout();
  const frame = toastFrame(size, width);
  // 宽屏没有底部标签栏：在内容区底部、离底 32
  const bottom =
    frame && !frame.aboveTabBar ? insets.bottom + space.xl + 4 : tabBarTop(insets.bottom) + space.m;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        frame ? { left: frame.left, right: undefined, width: frame.width } : null,
        { bottom, backgroundColor: palette.ink, boxShadow: palette.shadowFloat },
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
  lifted: { position: "absolute", overflow: "hidden" },
  cardMenu: { position: "absolute", borderRadius: radius.group, padding: space.s },
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
