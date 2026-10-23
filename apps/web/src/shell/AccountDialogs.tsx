/**
 * 账户小窗里打开的两个对话框：
 * - 修改密码：填当前密码和新密码；改完其他设备退出，这台设备换上新令牌；
 * - 删除账户：先列出会被删掉的存档、剧本、模型的数量，输入密码，再确认一次。删掉以后退出登录。
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";

import { Button, Notice, PasswordField } from "../components/controls.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { Dialog } from "../overlay/Dialog.tsx";
import { useOverlay } from "../overlay/OverlayProvider.tsx";
import overlay from "../overlay/overlay.module.css";
import { useApp } from "../state/AppProvider.tsx";
import styles from "./shell.module.css";

const MIN_PASSWORD = 8;

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { api, signIn } = useApp();
  const { toast } = useOverlay();
  const { t } = useTranslation();
  const first = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!current || next.length < MIN_PASSWORD || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.changePassword({ current_password: current, new_password: next }));
      onClose();
      toast(t("account.passwordChanged"), { icon: "check" });
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Dialog label={t("account.changePassword")} onClose={onClose} initialFocus={first}>
      <h2 className={overlay.dialogTitle}>{t("account.changePassword")}</h2>
      <form className={styles.dialogForm} onSubmit={(e) => void submit(e)} noValidate>
        {error ? <Notice message={error} /> : null}
        <PasswordField
          ref={first}
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
        <div className={overlay.dialogButtons}>
          <Button label={t("common.cancel")} variant="secondary" size="lg" onClick={onClose} />
          <Button
            type="submit"
            label={t("account.changePassword")}
            size="lg"
            busy={busy}
            disabled={!current || next.length < MIN_PASSWORD}
          />
        </div>
      </form>
    </Dialog>
  );
}

type Counts = { stories: number; scenarios: number; models: number };

export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { api, signOut } = useApp();
  const { confirm } = useOverlay();
  const { t } = useTranslation();
  const first = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.playthroughs.list(), api.scenarios.list(), api.models.list()])
      .then(([stories, scenarios, models]) =>
        setCounts({ stories: stories.length, scenarios: scenarios.length, models: models.length }),
      )
      .catch(() => undefined);
  }, [api]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!password || busy) return;
    const ok = await confirm({
      title: t("account.deleteTitle"),
      message: t("account.deleteMessage"),
      confirmLabel: t("account.deleteAccount"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.deleteAccount(password);
      await signOut();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const stat = (icon: IconName, value: number | undefined, label: string) => (
    <div className={styles.stat} aria-label={`${label} ${value ?? ""}`}>
      <span className={styles.statValue}>{value ?? "–"}</span>
      <span className={styles.statLabel}>
        <Icon name={icon} size={13} />
        {label}
      </span>
    </div>
  );

  return (
    <Dialog label={t("account.deleteAccount")} onClose={onClose} initialFocus={first}>
      <h2 className={overlay.dialogTitle}>{t("account.deleteTitle")}</h2>
      <div className={styles.stats}>
        {stat("story", counts?.stories, t("account.saves"))}
        {stat("library", counts?.scenarios, t("account.scenarios"))}
        {stat("key", counts?.models, t("account.models"))}
      </div>
      <p className={overlay.dialogMessage}>{t("account.deleteMessage")}</p>
      <form className={styles.dialogForm} onSubmit={(e) => void submit(e)} noValidate>
        {error ? <Notice message={error} /> : null}
        <PasswordField
          ref={first}
          label={t("account.confirmPassword")}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className={overlay.dialogButtons}>
          <Button label={t("common.cancel")} variant="secondary" size="lg" onClick={onClose} />
          <Button
            type="submit"
            label={t("account.deleteAccount")}
            variant="dangerSolid"
            size="lg"
            busy={busy}
            disabled={!password}
          />
        </div>
      </form>
    </Dialog>
  );
}
