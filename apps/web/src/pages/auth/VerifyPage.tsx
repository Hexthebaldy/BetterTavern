/**
 * 验证邮箱：注册以后（服务器要求验证邮箱时）、没验证就登录时来这里。验证码已经发出，填对了直接登录。
 * 邮箱从上一页带过来（路由的 state）；直接打开这个地址、没有邮箱时回注册页。
 * “重新发送”有 60 秒倒计时（服务端同一个邮箱 1 分钟只发 1 封）。同 App 的 app/(auth)/verify.tsx。
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { Button, Field, IconButton, Notice } from "../../components/controls.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { AuthLayout, NarrowIntro, useCooldown } from "./AuthLayout.tsx";
import styles from "./auth.module.css";

const CODE_LENGTH = 6;

/** 验证码的错误：错太多次作废时说清楚要重发 */
export function codeErrorText(e: unknown, burnt: string): string {
  if (e instanceof ApiError && e.code === "CODE_INVALID" && e.field("attempts_left") === 0) return burnt;
  return describeError(e);
}

export function VerifyPage() {
  const { api, signIn } = useApp();
  const navigate = useNavigate();
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
      <IconButton
        icon="back"
        label={t("auth.backToLogin")}
        className={styles.back}
        onClick={() => navigate("/login")}
      />
      <NarrowIntro />
      <div className={styles.heading}>
        <h1 className={styles.big}>{t("auth.verifyTitle")}</h1>
        <p className={styles.lead}>{t("auth.verifySent", { email })}</p>
      </div>
      {error ? <Notice message={error} onClose={() => setError(null)} /> : null}
      {info ? <Notice tone="info" message={info} onClose={() => setInfo(null)} /> : null}
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <Field
          label={t("auth.code")}
          className={styles.code}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t("auth.codePlaceholder")}
          maxLength={CODE_LENGTH}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        />
        <div className={styles.resendRow}>
          <span>{t("auth.checkSpam")}</span>
          <button
            type="button"
            className={styles.linkButton}
            disabled={cooldown.seconds > 0}
            onClick={() => void resend()}
          >
            {cooldown.seconds > 0 ? t("auth.resendIn", { seconds: cooldown.seconds }) : t("auth.resend")}
          </button>
        </div>
        <Button
          type="submit"
          label={t("auth.verifyAndLogin")}
          size="lg"
          between
          trailingIcon="arrowRight"
          busy={busy}
          disabled={!ready}
          className={styles.submit}
        />
      </form>
    </AuthLayout>
  );
}
