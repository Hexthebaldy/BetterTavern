/**
 * 账户小窗：窄屏底部栏的“更多”弹出，贴在按钮上方（宽屏没有它，账户在设置页的“账户”一格）。
 * 顶上是头像、昵称和邮箱；下面是设置、修改密码、退出登录、删除账户，最底下是三份条款的链接。
 * 窄屏底部栏没有“模型”“外部服务”，从这里进（connect）。
 * 修改密码、删除账户各开一个对话框（AccountDialogs.tsx）；对话框开着时小窗已经关了，所以状态放在 useAccountMenu 里。
 * 点外面、按 Esc、选了一项都会关上，焦点回到打开它的按钮。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import type { IconName } from "@bettertavern/design/icons";

import { cx } from "../components/controls.tsx";
import { Icon } from "../components/Icon.tsx";
import { useApp } from "../state/AppProvider.tsx";
import { ChangePasswordDialog, DeleteAccountDialog } from "./AccountDialogs.tsx";
import { Avatar } from "./Avatar.tsx";
import styles from "./shell.module.css";

const WIDTH = 280;
const MARGIN = 8;

type DialogKind = "password" | "delete" | null;

/** 打开小窗的按钮用 open(按钮)；element 放进页面（小窗和对话框都在里面） */
export function useAccountMenu(options: { connect?: boolean } = {}): {
  open: (anchor: HTMLElement) => void;
  isOpen: boolean;
  element: ReactNode;
} {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const open = useCallback((el: HTMLElement) => setAnchor(el), []);
  const element = (
    <>
      {anchor ? (
        <AccountMenu
          anchor={anchor}
          connect={options.connect ?? false}
          onClose={() => setAnchor(null)}
          onDialog={(kind) => {
            setAnchor(null);
            setDialog(kind);
          }}
        />
      ) : null}
      {dialog === "password" ? <ChangePasswordDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <DeleteAccountDialog onClose={() => setDialog(null)} /> : null}
    </>
  );
  return { open, isOpen: anchor !== null, element };
}

function AccountMenu({
  anchor,
  connect,
  onClose,
  onDialog,
}: {
  anchor: HTMLElement;
  connect: boolean;
  onClose: () => void;
  onDialog: (kind: Exclude<DialogKind, null>) => void;
}) {
  const { t } = useTranslation();
  const { user, signOut } = useApp();
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ left: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - WIDTH - MARGIN);
    setFrame({ left, bottom: window.innerHeight - rect.top + MARGIN });
  }, [anchor]);

  useEffect(() => {
    if (!frame) return;
    box.current?.querySelector<HTMLElement>("[data-item]")?.focus();
  }, [frame]);

  // 点外面（不含打开它的按钮）、按 Esc 关上
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (box.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchor.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!user) return null;
  const go = (to: string): void => {
    onClose();
    navigate(to);
  };
  const item = (key: string, icon: IconName, label: string, onClick: () => void, danger = false) => (
    <button
      key={key}
      type="button"
      data-item
      className={cx(styles.accountItem, danger && styles.accountItemDanger)}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
      {label}
    </button>
  );
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={t("nav.account")}
      className={cx(styles.accountMenu, "surface-sheet")}
      style={frame ? { left: frame.left, bottom: frame.bottom, width: WIDTH } : { visibility: "hidden" }}
    >
      <div className={styles.accountMenuHead}>
        <Avatar user={user} size={40} />
        <span className={styles.accountText}>
          <span className={styles.accountName}>{user.display_name || t("nav.noNickname")}</span>
          <span className={cx(styles.accountEmail, styles.mono)}>{user.email}</span>
        </span>
      </div>
      {connect ? (
        <>
          {item("models", "key", t("nav.models"), () => go("/models"))}
          {item("tools", "world", t("nav.tools"), () => go("/settings/tools"))}
          <div className={styles.accountRule} />
        </>
      ) : null}
      {item("settings", "settings", t("nav.settings"), () => go("/settings"))}
      {item("password", "lock", t("account.changePassword"), () => onDialog("password"))}
      {item("signOut", "logout", t("account.signOut"), () => {
        onClose();
        void signOut();
      })}
      <div className={styles.accountRule} />
      {item("delete", "trash", t("account.deleteAccount"), () => onDialog("delete"), true)}
      <nav className={styles.accountLegal} aria-label={t("legal.nav")}>
        <Link to="/terms" onClick={onClose}>
          {t("legal.terms")}
        </Link>
        <Link to="/privacy" onClick={onClose}>
          {t("legal.privacy")}
        </Link>
        <Link to="/rules" onClick={onClose}>
          {t("legal.rules")}
        </Link>
      </nav>
    </div>,
    document.body,
  );
}
