/**
 * 注册：邮箱、密码（至少 8 位，下面一条长度进度条）、可选的昵称，勾选“已满 18 岁并同意协议”。
 * 服务器要求验证邮箱时去验证页（验证码已经发出），否则直接登录。
 * 平板版式和登录一样（components/AuthLayout.tsx）：宽屏左边插画区，中屏表单宽 440 居中。
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { registeredSession } from "@bettertavern/core/auth/session";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { AuthBrand, AuthSplit, useAuthColumn, useAuthFormWidth } from "../../src/components/AuthLayout.tsx";
import { ServerRow, ServerSheet } from "../../src/components/ServerSetting.tsx";
import { BackBar, Button, Field, IconButton, Notice } from "../../src/components/ui.tsx";
import { AgreeRow } from "../../src/features/auth/parts.tsx";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { font, space, useComic } from "../../src/theme/index.ts";

const MIN_PASSWORD = 8;
const NAME_MAX = 40;

function LengthBar({ length }: { length: number }) {
  const c = useComic();
  const ratio = Math.min(length / MIN_PASSWORD, 1);
  const { t } = useTranslation();
  return (
    <View
      style={styles.lengthRow}
      accessibilityLabel={t("auth.passwordTyped", { length, min: MIN_PASSWORD })}
    >
      <View style={[styles.track, { backgroundColor: c.grey2 }]}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: c.ink }]} />
      </View>
      <Text style={[styles.meta, { color: c.mut }]}>
        {length >= MIN_PASSWORD ? t("auth.passwordLength", { count: length }) : `${length} / ${MIN_PASSWORD}`}
      </Text>
    </View>
  );
}

export default function RegisterScreen() {
  const { api, signIn, serverUrl } = useApp();
  const { serverUsed, serverFailed } = usePrefs();
  const c = useComic();
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const { compact, expanded } = useLayout();
  const column = useAuthColumn();
  const formWidth = useAuthFormWidth();

  const ready = !!email.trim() && password.length >= MIN_PASSWORD && agreed;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    // 还没设置服务器（自己构建、没写默认地址）：先打开服务器面板
    if (!serverUrl) {
      setServerOpen(true);
      return;
    }
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
      serverUsed(serverUrl);
      const auth = registeredSession(response);
      if (auth) await signIn(auth);
      else {
        setBusy(false);
        router.push({ pathname: "/verify", params: { email: response.user.email } });
      }
    } catch (e) {
      setBusy(false);
      const field = e instanceof ApiError ? e.field("field") : undefined;
      if (typeof field === "string") setFieldError({ field, message: describeError(e) });
      else if (e instanceof ApiError && e.isNetwork) {
        serverFailed(serverUrl);
        setError(t("auth.cantConnect"));
        setServerOpen(true);
      } else setError(describeError(e));
    }
  };

  const errorFor = (field: string): string | null =>
    fieldError?.field === field ? fieldError.message : null;

  const form = (
    <View style={{ flex: 1 }}>
      <BackBar onBack={() => router.replace("/login")} />
      <ScrollView
        contentContainerStyle={[styles.content, compact ? null : styles.centered, column]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 宽屏左边的桌面上没有字：Logo 和名字放在表单顶上 */}
        {expanded ? <AuthBrand /> : null}
        <Text accessibilityRole="header" style={[styles.big, { color: c.ink }]}>
          {t("auth.registerTitle")}
        </Text>
        {error ? <Notice message={error} /> : null}
        <View style={styles.form}>
          <Field
            label={t("auth.email")}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            error={errorFor("email")}
          />
          <Field
            label={t("auth.password")}
            value={password}
            onChangeText={setPassword}
            placeholder={t("auth.passwordMin", { min: MIN_PASSWORD })}
            secureTextEntry={!reveal}
            autoComplete="new-password"
            textContentType="newPassword"
            error={errorFor("password")}
            trailing={
              <IconButton
                icon={reveal ? "eyeOff" : "eye"}
                label={reveal ? t("auth.hidePassword") : t("auth.showPassword")}
                tone="plain"
                diameter={44}
                color={c.mut}
                onPress={() => setReveal((r) => !r)}
              />
            }
            below={password.length > 0 ? <LengthBar length={password.length} /> : null}
          />
          <Field
            label={t("auth.nickname")}
            optional
            counter
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            onSubmitEditing={() => void submit()}
          />
          <AgreeRow checked={agreed} onToggle={() => setAgreed((v) => !v)} serverUrl={serverUrl} />
          <Button
            label={t("auth.register")}
            trailingIcon="arrowRight"
            between
            onPress={() => void submit()}
            busy={busy}
            disabled={!ready}
            style={{ marginTop: space.xs }}
          />
        </View>
      </ScrollView>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.page }}
    >
      <AuthSplit
        form={form}
        desk="start"
        footer={<ServerRow onChange={() => setServerOpen(true)} width={formWidth} />}
      />
      <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.page, paddingTop: space.l, paddingBottom: space.xxl, gap: space.xl },
  centered: { flexGrow: 1, justifyContent: "center" },
  big: { fontSize: 34, lineHeight: 42, fontWeight: "900", letterSpacing: -0.7 },
  form: { gap: 18 },
  lengthRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: space.xs },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  meta: { fontFamily: font.mono, fontSize: 12, lineHeight: 16 },
});
