/**
 * 登录（W01）。真正的 <form>，浏览器和密码管理器能自动填充；打开时焦点在邮箱，在密码框按 Enter 就提交。
 * 文案和错误提示同 App 的 app/(auth)/login.tsx。
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";

import { Button, Field, Notice, PasswordField } from "../../components/controls.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { AuthLayout, NarrowIntro } from "./AuthLayout.tsx";
import styles from "./auth.module.css";

export function LoginPage() {
  const { api, signIn } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle("登录");

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
      setError(e instanceof ApiError && e.isNetwork ? "连不上服务器，检查网络后再试。" : describeError(e));
    }
  };

  return (
    <AuthLayout>
      <NarrowIntro lead />
      <h1 className={styles.big}>继续你的故事</h1>
      {error ? <Notice message={error} onClose={() => setError(null)} /> : null}
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <Field
          label="邮箱"
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
        <PasswordField
          label="密码"
          name="password"
          autoComplete="current-password"
          placeholder="输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          type="submit"
          label="登录"
          size="lg"
          between
          trailingIcon="arrowRight"
          busy={busy}
          disabled={!ready}
          className={styles.submit}
        />
        <div className={styles.switch}>
          还没有账户？<Link to="/register">注册</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
