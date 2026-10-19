/**
 * 给页面用的 useOverlay()：确认、输入一行文字、菜单、提示浮条。同时只有一个对话框或菜单，新的把旧的当作取消。
 *
 * - 确认和输入是居中对话框，和 App 的 Dialog 一样：上方一个圆形图标写清后果，删除用红色、提醒用琥珀色；
 * - 菜单是右键菜单的样子（宽 240），左上角在鼠标处或贴着按钮；
 * - 浮条在内容区底部居中（宽 ≤ 480），4 秒后消失，鼠标停在上面时不消失。
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
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";

import type { IconName } from "@bettertavern/design/icons";

import { Button, cx } from "../components/controls.tsx";
import { Icon } from "../components/Icon.tsx";
import { timing } from "../theme/layout.ts";
import { Dialog } from "./Dialog.tsx";
import { Menu, type MenuItem, type MenuPlace } from "./Menu.tsx";
import styles from "./overlay.module.css";

export type DialogTone = "danger" | "warn" | "default";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
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
  /** 可以不填：空着也能确认，这时返回空串 */
  optional?: boolean;
  /** 多行（写结局的方向这类长文字）：回车换行，Ctrl / ⌘ + Enter 等于点确认 */
  multiline?: boolean;
};

export type MenuOptions = { label: string; items: MenuItem[]; place: MenuPlace };

export type ToastOptions = { icon?: IconName; actionLabel?: string; onAction?: () => void };

export type Overlay = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** 输入一行文字；取消返回 null。必填时没填不能确认，optional 时没填返回空串 */
  prompt: (options: PromptOptions) => Promise<string | null>;
  /** 返回选中项的 key；点外面、按 Esc 返回 null */
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
  if (!value) throw new Error("useOverlay must be used inside OverlayProvider");
  return value;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const current = useRef<Request | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string; options: ToastOptions } | null>(null);
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
      settle(null);
      current.current = next;
      setRequest(next);
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

  return (
    <OverlayContext.Provider value={overlay}>
      {children}
      {request?.kind === "confirm" ? (
        <ConfirmDialog options={request.options} onSettle={(ok) => settle(ok)} />
      ) : null}
      {request?.kind === "prompt" ? <PromptDialog options={request.options} onSettle={settle} /> : null}
      {request?.kind === "menu" ? (
        <Menu
          label={request.options.label}
          items={request.options.items}
          place={request.options.place}
          onSettle={settle}
        />
      ) : null}
      {toast ? (
        <Toast key={toast.id} message={toast.message} options={toast.options} onDone={() => setToast(null)} />
      ) : null}
    </OverlayContext.Provider>
  );
}

function toneOf(tone: DialogTone): { icon: IconName | undefined; className: string | undefined } {
  if (tone === "danger") return { icon: "trash", className: styles.danger };
  if (tone === "warn") return { icon: "alert", className: styles.warn };
  return { icon: undefined, className: undefined };
}

/** 对话框的内容：圆形图标、标题、说明，下面是“取消”和确认两个按钮 */
export function DialogCard({
  tone = "default",
  icon,
  title,
  message,
  children,
  cancelLabel,
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
  cancelRef,
  confirmRef,
}: {
  tone?: DialogTone;
  icon?: IconName;
  title: string;
  message?: ReactNode;
  children?: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  cancelRef?: Ref<HTMLButtonElement>;
  confirmRef?: Ref<HTMLButtonElement>;
}) {
  const look = toneOf(tone);
  const { t } = useTranslation();
  const shownIcon = icon ?? look.icon;
  return (
    <>
      <div className={styles.dialogBody}>
        {shownIcon ? (
          <span className={cx(styles.dialogIcon, look.className)}>
            <Icon name={shownIcon} size={24} />
          </span>
        ) : null}
        <h2 className={styles.dialogTitle}>{title}</h2>
        {message ? <div className={styles.dialogMessage}>{message}</div> : null}
        {children}
      </div>
      <div className={styles.dialogButtons}>
        <Button
          ref={cancelRef}
          label={cancelLabel ?? t("common.cancel")}
          variant="secondary"
          size="lg"
          onClick={onCancel}
        />
        <Button
          ref={confirmRef}
          label={confirmLabel}
          variant={tone === "danger" ? "dangerSolid" : "primary"}
          size="lg"
          disabled={confirmDisabled}
          onClick={onConfirm}
        />
      </div>
    </>
  );
}

function ConfirmDialog({ options, onSettle }: { options: ConfirmOptions; onSettle: (ok: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  // 删除、揭示秘密之类不可撤回的操作，默认焦点落在“取消”上
  const careful = options.tone === "danger" || options.tone === "warn";
  return (
    <Dialog label={options.title} onClose={() => onSettle(false)} initialFocus={careful ? cancel : confirm}>
      <DialogCard
        {...options}
        cancelRef={cancel}
        confirmRef={confirm}
        onCancel={() => onSettle(false)}
        onConfirm={() => onSettle(true)}
      />
    </Dialog>
  );
}

function PromptDialog({
  options,
  onSettle,
}: {
  options: PromptOptions;
  onSettle: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(options.initial ?? "");
  const { t } = useTranslation();
  const multiline = options.multiline === true;
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const text = draft.trim();
  const ready = text.length > 0 || options.optional === true;
  useEffect(() => {
    input.current?.select();
    // 多行时光标放在末尾，不全选
    const node = area.current;
    node?.setSelectionRange(node.value.length, node.value.length);
  }, []);
  return (
    <Dialog label={options.title} onClose={() => onSettle(null)} initialFocus={multiline ? area : input}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onSettle(text);
        }}
      >
        <DialogCard
          title={options.title}
          message={options.message}
          confirmLabel={options.confirmLabel ?? t("common.save")}
          confirmDisabled={!ready}
          onCancel={() => onSettle(null)}
          onConfirm={() => ready && onSettle(text)}
        >
          {multiline ? (
            <textarea
              ref={area}
              rows={4}
              className={cx(styles.promptInput, styles.promptMultiline)}
              aria-label={options.label}
              value={draft}
              maxLength={options.maxLength}
              placeholder={options.placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // 回车换行；Ctrl / ⌘ + Enter 等于点确认
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (ready) onSettle(text);
                }
              }}
            />
          ) : (
            <input
              ref={input}
              className={styles.promptInput}
              aria-label={options.label}
              value={draft}
              maxLength={options.maxLength}
              placeholder={options.placeholder}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </DialogCard>
      </form>
    </Dialog>
  );
}

/** 墨色胶囊浮条：4 秒后消失；鼠标停在上面、键盘焦点在里面时不消失 */
function Toast({ message, options, onDone }: { message: string; options: ToastOptions; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDone, timing.toast);
    return () => clearTimeout(timer);
  }, [held, onDone]);
  return (
    <div
      role="status"
      className={styles.toast}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Icon name={options.icon ?? "checkCircle"} size={18} />
      <span className={styles.toastText}>{message}</span>
      {options.actionLabel && options.onAction ? (
        <button
          type="button"
          className={styles.toastAction}
          onClick={() => {
            options.onAction?.();
            onDone();
          }}
        >
          {options.actionLabel}
        </button>
      ) : null}
    </div>
  );
}
