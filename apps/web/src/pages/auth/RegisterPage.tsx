/**
 * 注册（W02，漫画稿 11）：邮箱、密码（至少 8 位，下面一行写已经输了几位）、可选的昵称，勾选“已满 18 岁并同意协议”；
 * 主按钮印着 Enter，下面是“返回登录”。左格的桌面是“刚开始”的样子。
 * 服务器要求验证邮箱时去验证页（验证码已经发出），否则直接登录。
 * 文案、校验和错误提示同 App 的 app/(auth)/register.tsx；服务端指出是哪个字段时，错误显示在那个字段下面。
 */

import { useState, type FormEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { registeredSession } from "@bettertavern/core/auth/session";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { Button, buttonClass, cx, Field, Notice, PasswordField } from "../../components/controls.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { AgreeRow, AuthBrand, AuthLayout, AuthTitle } from "./AuthLayout.tsx";
import styles from "./auth.module.css";

const MIN_PASSWORD = 8;
const NAME_MAX = 40;

/** 密码下面的一行字：不到 8 位时是橙色的“已输入 5 位，至少 8 位”，够了写“已输入 N 位” */
function PasswordHint({ length }: { length: number }) {
  const { t } = useTranslation();
  const short = length < MIN_PASSWORD;
  return (
    <span className={cx(styles.note, short && styles.warn)}>
      {short ? t("auth.passwordTyped", { length, min: MIN_PASSWORD }) : t("auth.passwordLength", { count: length })}
    </span>
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
    <AuthLayout desk="start" server>
      <AuthBrand />
      <AuthTitle>{t("auth.registerTitle")}</AuthTitle>
      {error ? <Notice message={error} onClose={() => setError(null)} className={styles.notice} /> : null}
      <form className={`${styles.form} ${styles.register}`} onSubmit={(e) => void submit(e)} noValidate>
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
        <PasswordField
          size="lg"
          label={t("auth.password")}
          name="new-password"
          autoComplete="new-password"
          placeholder={t("auth.passwordMin", { min: MIN_PASSWORD })}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errorFor("password")}
          below={password.length > 0 ? <PasswordHint length={password.length} /> : null}
        />
        <Field
          size="lg"
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
          kbd="Enter"
          busy={busy}
          disabled={!ready}
          className={styles.main}
        />
        <Link to="/login" className={cx(buttonClass("secondary", "lg"), styles.second)}>
          {t("auth.backToLogin")}
        </Link>
      </form>
    </AuthLayout>
  );
}
