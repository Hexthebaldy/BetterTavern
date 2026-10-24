/**
 * 注册（W02）：邮箱、密码（至少 8 位，下面一条长度进度条）、可选的昵称，勾选“已满 18 岁并同意协议”。
 * 服务器要求验证邮箱时去验证页（验证码已经发出），否则直接登录。
 * 文案、校验和错误提示同 App 的 app/(auth)/register.tsx；服务端指出是哪个字段时，错误显示在那个字段下面。
 */

import { useState, type FormEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { registeredSession } from "@bettertavern/core/auth/session";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { Button, Field, IconButton, Notice, PasswordField } from "../../components/controls.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { AgreeRow, AuthLayout, NarrowIntro } from "./AuthLayout.tsx";
import styles from "./auth.module.css";
import { ServerSwitch } from "./ServerSwitch.tsx";

const MIN_PASSWORD = 8;
const NAME_MAX = 40;

function LengthBar({ length }: { length: number }) {
  const { t } = useTranslation();
  const ratio = Math.min(length / MIN_PASSWORD, 1);
  return (
    <div className={styles.lengthRow} aria-label={t("auth.passwordTyped", { length, min: MIN_PASSWORD })}>
      <div className={styles.track}>
        <div
          className={`${styles.fill} ${ratio >= 1 ? styles.enough : ""}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className={styles.meta}>
        {length >= MIN_PASSWORD ? t("auth.passwordLength", { count: length }) : `${length} / ${MIN_PASSWORD}`}
      </span>
    </div>
  );
}

export function RegisterPage() {
  const { api, signIn } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const { t } = useTranslation();
  useDocumentTitle(t("auth.register"));

  const ready = !!email.trim() && password.length >= MIN_PASSWORD && agreed;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const response = await api.auth.register({
        email: email.trim(),
        password,
        display_name: name.trim(),
        locale: currentLanguage(),
      });
      const auth = registeredSession(response);
      if (auth) await signIn(auth);
      else navigate("/verify", { state: { email: response.user.email } });
    } catch (e) {
      setBusy(false);
      const field = e instanceof ApiError ? e.field("field") : undefined;
      if (typeof field === "string") setFieldError({ field, message: describeError(e) });
      else if (e instanceof ApiError && e.isNetwork) setError(t("auth.cantConnect"));
      else setError(describeError(e));
    }
  };

  const errorFor = (field: string): string | null =>
    fieldError?.field === field ? fieldError.message : null;

  return (
    <AuthLayout>
      <IconButton
        icon="back"
        label={t("auth.backToLogin")}
        className={styles.back}
        onClick={() => navigate("/login")}
      />
      <NarrowIntro />
      <h1 className={styles.big}>{t("auth.registerTitle")}</h1>
      {error ? <Notice message={error} onClose={() => setError(null)} /> : null}
      <form className={`${styles.form} ${styles.register}`} onSubmit={(e) => void submit(e)} noValidate>
        <Field
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
        <PasswordField
          label={t("auth.password")}
          name="new-password"
          autoComplete="new-password"
          placeholder={t("auth.passwordMin", { min: MIN_PASSWORD })}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errorFor("password")}
          below={password.length > 0 ? <LengthBar length={password.length} /> : null}
        />
        <Field
          label={t("auth.nickname")}
          optional
          counter
          name="nickname"
          autoComplete="nickname"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errorFor("display_name")}
        />
        <AgreeRow checked={agreed} onToggle={() => setAgreed((v) => !v)}>
          <Trans
            i18nKey="auth.agree"
            components={{
              terms: <a href="/terms" target="_blank" rel="noopener" />,
              privacy: <a href="/privacy" target="_blank" rel="noopener" />,
              rules: <a href="/rules" target="_blank" rel="noopener" />,
            }}
          />
        </AgreeRow>
        <Button
          type="submit"
          label={t("auth.register")}
          size="lg"
          between
          trailingIcon="arrowRight"
          busy={busy}
          disabled={!ready}
          className={styles.submit}
        />
      </form>
      <ServerSwitch />
    </AuthLayout>
  );
}
