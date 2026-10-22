/**
 * 账户（W15，同 App 的 AccountBody）：头像、昵称、注册日期，邮箱和昵称，退出登录；
 * 修改密码折叠着，展开后填当前密码和新密码（改完其他设备退出，这台设备换上新令牌）；
 * 删除账户放在最底下，展开后先列出会被删掉的数量，输入密码，再弹确认框。内容居中，宽 520。
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import { formatDate } from "@bettertavern/core/utils/format";

import { Button, Notice, PasswordField } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import styles from "./settings.module.css";

type Counts = { stories: number; scenarios: number; models: number };

const MIN_PASSWORD = 8;

function ChangePassword() {
  const { api, signIn } = useApp();
  const overlay = useOverlay();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!current || next.length < MIN_PASSWORD || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.changePassword({ current_password: current, new_password: next }));
      setCurrent("");
      setNext("");
      setOpen(false);
      overlay.toast(t("account.passwordChanged"), { icon: "check" });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.fold}>
      <button type="button" className={styles.foldHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="key" size={20} />
        <span className={styles.flex}>{t("account.changePassword")}</span>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={18} />
      </button>
      {open ? (
        <form className={styles.foldForm} onSubmit={(e) => void submit(e)} noValidate>
          {error ? <Notice message={error} /> : null}
          <PasswordField
            label={t("account.currentPassword")}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <PasswordField
            label={t("account.newPassword")}
            autoComplete="new-password"
            placeholder={t("auth.passwordMin", { min: MIN_PASSWORD })}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <Button
            type="submit"
            label={t("account.changePassword")}
            size="lg"
            busy={busy}
            disabled={!current || next.length < MIN_PASSWORD}
          />
        </form>
      ) : null}
    </div>
  );
}

export function AccountBody() {
  const { api, user, signOut } = useApp();
  const overlay = useOverlay();
  const [expanded, setExpanded] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useDocumentTitle(t("settings.account"));

  const name = user?.display_name || user?.email || "";
  const joined = user?.created_at ? formatDate(user.created_at) : "";

  const toggle = (): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && !counts) {
      Promise.all([api.playthroughs.list(), api.scenarios.list(), api.models.list()])
        .then(([stories, scenarios, models]) =>
          setCounts({ stories: stories.length, scenarios: scenarios.length, models: models.length }),
        )
        .catch(() => undefined);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("account.deleteTitle"),
      message: t("account.deleteMessage"),
      confirmLabel: t("account.deleteAccount"),
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.auth.deleteAccount(password);
      await signOut();
    } catch (e) {
      setError(describeError(e));
      setDeleting(false);
    }
  };

  const stat = (icon: IconName, value: number | undefined, label: string) => (
    <div className={styles.accountStat} aria-label={`${label} ${value ?? ""}`}>
      <span className={styles.accountStatValue}>{value ?? "–"}</span>
      <span className={styles.accountStatLabel}>
        <Icon name={icon} size={13} />
        {label}
      </span>
    </div>
  );

  return (
    <div className={styles.account}>
      <div className={styles.accountHead}>
        <span className={styles.bigAvatar}>{Array.from(name)[0] ?? "?"}</span>
        <h2 className={styles.accountName}>{name}</h2>
        {joined ? <span className={styles.rowSub}>{t("account.joined", { date: joined })}</span> : null}
      </div>
      <div className={styles.kvGroup}>
        <div className={styles.kv}>
          <span className={styles.kvKey}>{t("account.email")}</span>
          <span className={styles.kvValue}>{user?.email}</span>
        </div>
        <div className={styles.kv}>
          <span className={styles.kvKey}>{t("account.nickname")}</span>
          <span className={user?.display_name ? styles.kvValue : styles.muted}>
            {user?.display_name || t("account.notSet")}
          </span>
        </div>
      </div>
      <ChangePassword />
      <Button
        label={t("account.signOut")}
        variant="secondary"
        icon="logout"
        size="lg"
        busy={leaving}
        onClick={() => {
          setLeaving(true);
          void signOut();
        }}
      />
      <nav className={styles.legalLinks} aria-label={t("legal.nav")}>
        <Link to="/terms">{t("legal.terms")}</Link>
        <Link to="/privacy">{t("legal.privacy")}</Link>
        <Link to="/rules">{t("legal.rules")}</Link>
      </nav>
      <div className={styles.danger}>
        <button type="button" className={styles.dangerHead} aria-expanded={expanded} onClick={toggle}>
          <Icon name="alert" size={20} />
          <span className={styles.flex}>{t("account.deleteAccount")}</span>
          <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} />
        </button>
        {expanded ? (
          <div className={styles.dangerBody}>
            <div className={styles.accountStats}>
              {stat("story", counts?.stories, t("account.saves"))}
              {stat("library", counts?.scenarios, t("account.scenarios"))}
              {stat("key", counts?.models, t("account.models"))}
            </div>
            <p className={styles.lead}>{t("account.deleteMessage")}</p>
            {error ? <Notice message={error} /> : null}
            <form
              className={styles.dangerForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (password) void confirmDelete();
              }}
            >
              <PasswordField
                label={t("account.confirmPassword")}
                className={styles.hiddenLabel}
                placeholder={t("account.confirmPassword")}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                type="submit"
                label={t("account.deleteAccount")}
                variant="dangerSolid"
                size="lg"
                busy={deleting}
                disabled={!password}
              />
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
