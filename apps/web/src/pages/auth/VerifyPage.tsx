/**
 * 验证邮箱：注册以后（服务器要求验证邮箱时）、没验证就登录时来这里。验证码已经发出，填对了直接登录。
 * 邮箱从上一页带过来（路由的 state）；直接打开这个地址、没有邮箱时回注册页。
 * “重新发送”有 60 秒倒计时（服务端同一个邮箱 1 分钟只发 1 封）。同 App 的 app/(auth)/verify.tsx。
 * 版式见漫画稿 12：邮箱在标题下的灰色小块里，验证码是 6 个格子；“换一个邮箱”回注册页。
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { Button, cx, Notice } from "../../components/controls.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { AuthBrand, AuthLayout, AuthTitle, CODE_LENGTH, CodeField, EmailChip, useCooldown } from "./AuthLayout.tsx";
import styles from "./auth.module.css";


/** 验证码的错误：错太多次作废时说清楚要重发 */
export function codeErrorText(e: unknown, burnt: string): string {
  if (e instanceof ApiError && e.code === "CODE_INVALID" && e.field("attempts_left") === 0) return burnt;
  return describeError(e);
}

export function VerifyPage() {
  const { api, signIn } = useApp();
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // 进来时验证码刚发过
  const cooldown = useCooldown(60);
  const { t } = useTranslation();
  useDocumentTitle(t("auth.verifyTitle"));

  if (!email) return <Navigate to="/register" replace />;

  const ready = code.length === CODE_LENGTH;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.verifyEmail({ email, code }));
    } catch (e) {
      setBusy(false);
      setError(codeErrorText(e, t("auth.codeBurnt")));
    }
  };

  const resend = async (): Promise<void> => {
    setError(null);
    setInfo(null);
    cooldown.start();
    try {
      await api.auth.sendCode({ email, purpose: "verify", locale: currentLanguage() });
      setInfo(t("auth.resent"));
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <AuthLayout>
      <AuthBrand />
      <AuthTitle below={<EmailChip email={email} />}>{t("auth.verifyTitle")}</AuthTitle>
      {error ? <Notice message={error} onClose={() => setError(null)} className={styles.notice} /> : null}
      {info ? <Notice tone="info" message={info} onClose={() => setInfo(null)} className={styles.notice} /> : null}
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <CodeField value={code} onChange={setCode} aside={t("auth.codeValid")} autoFocus />
        <div className={styles.resendRow}>
          <button
            type="button"
            className={styles.linkButton}
            disabled={cooldown.seconds > 0}
            onClick={() => void resend()}
          >
            {cooldown.seconds > 0 ? t("auth.resendIn", { seconds: cooldown.seconds }) : t("auth.resend")}
          </button>
          <Link to="/register" className={styles.linkButton}>
            {t("auth.changeEmail")}
          </Link>
        </div>
        <p className={cx(styles.note, styles.spam)}>{t("auth.checkSpam")}</p>
        <Button
          type="submit"
          label={t("auth.verifyAndLogin")}
          size="lg"
          kbd="Enter"
          busy={busy}
          disabled={!ready}
          className={styles.main}
        />
      </form>
    </AuthLayout>
  );
}
