/**
 * 找回密码，两步：先填邮箱发验证码；再填验证码和新密码，设好以后直接登录（其他设备上的登录都退出）。
 * 服务端不透露邮箱是否注册过，所以第二步的提示是“如果注册过，验证码已经发过去了”。同 App 的 app/(auth)/forgot.tsx。
 * 没有单独的稿子，版式同验证邮箱（漫画稿 12）：验证码是 6 个格子，主按钮印着 Enter。
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { Button, buttonClass, cx, Field, Notice, PasswordField } from "../../components/controls.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { AuthBrand, AuthLayout, AuthTitle, CODE_LENGTH, CodeField, useCooldown } from "./AuthLayout.tsx";
import styles from "./auth.module.css";
import { codeErrorText } from "./VerifyPage.tsx";

const MIN_PASSWORD = 8;

export function ForgotPage() {
  const { api, signIn } = useApp();
  const location = useLocation();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? "");
  const [step, setStep] = useState<"email" | "reset">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const cooldown = useCooldown();
  const { t } = useTranslation();
  useDocumentTitle(t("auth.forgotTitle"));

  const send = async (): Promise<boolean> => {
    setError(null);
    setFieldError(null);
    try {
      await api.auth.sendCode({ email: email.trim(), purpose: "reset", locale: currentLanguage() });
      cooldown.start();
      return true;
    } catch (e) {
      const field = e instanceof ApiError ? e.field("field") : undefined;
      if (field === "email") setFieldError({ field, message: describeError(e) });
      else setError(e instanceof ApiError && e.isNetwork ? t("auth.cantConnect") : describeError(e));
      return false;
    }
  };

  const submitEmail = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    const sent = await send();
    setBusy(false);
    if (sent) setStep("reset");
  };

  const submitReset = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH || password.length < MIN_PASSWORD || busy) return;
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      await signIn(await api.auth.resetPassword({ email: email.trim(), code, new_password: password }));
    } catch (e) {
      setBusy(false);
      const field = e instanceof ApiError ? e.field("field") : undefined;
      if (field === "new_password") setFieldError({ field, message: describeError(e) });
      else setError(codeErrorText(e, t("auth.codeBurnt")));
    }
  };

  const errorFor = (field: string): string | null =>
    fieldError?.field === field ? fieldError.message : null;

  return (
    <AuthLayout>
      <AuthBrand />
      <AuthTitle
        below={
          <p className={styles.lead}>
            {step === "email" ? t("auth.forgotLead") : t("auth.resetSent", { email: email.trim() })}
          </p>
        }
      >
        {step === "email" ? t("auth.forgotTitle") : t("auth.resetTitle")}
      </AuthTitle>
      {error ? <Notice message={error} onClose={() => setError(null)} className={styles.notice} /> : null}
      {step === "email" ? (
        <form className={styles.form} onSubmit={(e) => void submitEmail(e)} noValidate>
          <Field
            size="lg"
            label={t("auth.email")}
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errorFor("email")}
          />
          <Button
            type="submit"
            label={t("auth.sendCode")}
            size="lg"
            kbd="Enter"
            busy={busy}
            disabled={!email.trim()}
            className={styles.main}
          />
          <Link to="/login" className={cx(buttonClass("secondary", "lg"), styles.second)}>
            {t("auth.backToLogin")}
          </Link>
        </form>
      ) : (
        <form className={styles.form} onSubmit={(e) => void submitReset(e)} noValidate>
          {/* 让密码管理器知道这是哪个账号的新密码 */}
          <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
          <CodeField value={code} onChange={setCode} aside={t("auth.codeValid")} autoFocus />
          <div className={styles.resendRow}>
            <button
              type="button"
              className={styles.linkButton}
              disabled={cooldown.seconds > 0}
              onClick={() => void send()}
            >
              {cooldown.seconds > 0 ? t("auth.resendIn", { seconds: cooldown.seconds }) : t("auth.resend")}
            </button>
            <button type="button" className={styles.linkButton} onClick={() => setStep("email")}>
              {t("auth.changeEmail")}
            </button>
          </div>
          <PasswordField
            size="lg"
            label={t("auth.newPassword")}
            name="new-password"
            autoComplete="new-password"
            placeholder={t("auth.passwordMin", { min: MIN_PASSWORD })}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errorFor("new_password")}
          />
          <Button
            type="submit"
            label={t("auth.resetAndLogin")}
            size="lg"
            kbd="Enter"
            busy={busy}
            disabled={code.length !== CODE_LENGTH || password.length < MIN_PASSWORD}
            className={styles.main}
          />
        </form>
      )}
    </AuthLayout>
  );
}
