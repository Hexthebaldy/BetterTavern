/**
 * 登录（W01）。真正的 <form>，浏览器和密码管理器能自动填充；打开时焦点在邮箱，在密码框按 Enter 就提交。
 * 邮箱还没验证（EMAIL_NOT_VERIFIED，服务端已经重发了验证码）时去验证页。
 * 文案和错误提示同 App 的 app/(auth)/login.tsx。版式见 AuthLayout（漫画稿 10）：“忘记密码？”在密码标签那一行，
 * 主按钮印着 Enter，下面是“注册新账户”；底部是服务器行（只在自己部署的网页上）和三份条款。
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";

import { Button, buttonClass, cx, Field, Notice, PasswordField } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { AuthBrand, AuthLayout, AuthTitle } from "./AuthLayout.tsx";
import styles from "./auth.module.css";

export function LoginPage() {
  const { api, signIn } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useDocumentTitle(t("auth.login"));

  const ready = !!email.trim() && !!password;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.login({ email: email.trim(), password }));
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.code === "EMAIL_NOT_VERIFIED") {
        const registered = e.field("email");
        navigate("/verify", { state: { email: typeof registered === "string" ? registered : email.trim() } });
        return;
      }
      setError(e instanceof ApiError && e.isNetwork ? t("auth.cantConnect") : describeError(e));
    }
  };

  return (
    <AuthLayout server>
      <AuthBrand lead />
      <AuthTitle>{t("auth.loginTitle")}</AuthTitle>
      {error ? <Notice message={error} onClose={() => setError(null)} className={styles.notice} /> : null}
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
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
        />
        <div className={styles.passwordWrap}>
          <PasswordField
            size="lg"
            label={t("auth.password")}
            name="password"
            autoComplete="current-password"
            placeholder={t("auth.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Link to="/forgot" state={{ email: email.trim() }} className={styles.forgot}>
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <Button
          type="submit"
          label={t("auth.login")}
          size="lg"
          kbd="Enter"
          busy={busy}
          disabled={!ready}
          className={styles.main}
        />
        <Link to="/register" className={cx(buttonClass("secondary", "lg"), styles.second)}>
          {t("auth.registerNew")}
          <Icon name="arrowRight" size={18} />
        </Link>
      </form>
    </AuthLayout>
  );
}
