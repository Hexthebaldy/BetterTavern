/**
 * 居中对话框（服务器之外的确认、输入、外观、快捷键……）：宽 ≤ 480，圆角 32，后面是遮罩。
 * 用浏览器的 <dialog>：打开后焦点移进来、Tab 在里面循环；Esc 或点遮罩关闭；关闭后焦点回到打开它的地方。
 * 默认焦点由调用方指定（删除类、揭示秘密落在“取消”上）；没指定时落在第一个能聚焦的元素上。
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

import { cx } from "../components/controls.tsx";
import styles from "./overlay.module.css";

export function Dialog({
  label,
  onClose,
  initialFocus,
  width,
  className,
  children,
}: {
  /** 读屏用的名字（通常就是标题） */
  label: string;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog.close();
      opener?.focus({ preventScroll: true });
    };
    // 只在打开时做一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Esc：浏览器会发 cancel；交给调用方关闭（由它决定要不要卸载）
    const onCancel = (event: Event): void => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={cx(styles.dialog, "surface-sheet", className)}
      style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
      // 点到 <dialog> 本身（而不是里面的内容）就是点在遮罩上
      onClick={(event) => {
        if (event.target === ref.current) close.current();
      }}
    >
      <div className={styles.dialogInner}>{children}</div>
    </dialog>
  );
}
