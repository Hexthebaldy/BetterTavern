/**
 * 找回密码，两步：先填邮箱发验证码；再填验证码和新密码，设好以后直接登录（其他设备上的登录都退出）。
 * 服务端不透露邮箱是否注册过，所以第二步的提示是“如果注册过，验证码已经发过去了”。同网页端 pages/auth/ForgotPage.tsx。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { AuthSplit, useAuthColumn } from "../../src/components/AuthLayout.tsx";
import { BackBar, Button, Field, IconButton, Notice } from "../../src/components/ui.tsx";
import { cleanCode, codeErrorText, useCooldown } from "../../src/features/auth/parts.tsx";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, useComic } from "../../src/theme/index.ts";

const MIN_PASSWORD = 8;

export default function ForgotScreen() {
  const { api, signIn } = useApp();
  const c = useComic();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [step, setStep] = useState<"email" | "reset">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown();
  const { compact } = useLayout();
  const column = useAuthColumn();

  const send = async (): Promise<boolean> => {
    setError(null);
    try {
      await api.auth.sendCode({ email: email.trim(), purpose: "reset", locale: currentLanguage() });
      cooldown.start();
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.isNetwork ? t("auth.cantConnect") : describeError(e));
      return false;
    }
  };

  const submitEmail = async (): Promise<void> => {
    if (!email.trim() || busy) return;
    setBusy(true);
    const sent = await send();
    setBusy(false);
    if (sent) setStep("reset");
  };

  const ready = code.length === 6 && password.length >= MIN_PASSWORD;

  const submitReset = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.resetPassword({ email: email.trim(), code, new_password: password }));
    } catch (e) {
      setBusy(false);
      setError(codeErrorText(e, t("auth.codeBurnt")));
    }
  };

  const link = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={styles.link}
    >
      <Text style={{ fontSize: 14, fontWeight: "700", color: disabled ? c.mut : c.acc }}>{label}</Text>
    </Pressable>
  );

  const form = (
    <View style={{ flex: 1 }}>
      <BackBar onBack={() => router.replace("/login")} />
      <ScrollView
        contentContainerStyle={[styles.content, compact ? null : styles.centered, column]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={[styles.big, { color: c.ink }]}>
            {step === "email" ? t("auth.forgotTitle") : t("auth.resetTitle")}
          </Text>
          <Text style={[styles.lead, { color: c.mut }]}>
            {step === "email" ? t("auth.forgotLead") : t("auth.resetSent", { email: email.trim() })}
          </Text>
        </View>
        {error ? <Notice message={error} /> : null}
        {step === "email" ? (
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
              autoFocus
              onSubmitEditing={() => void submitEmail()}
            />
            <Button
              label={t("auth.sendCode")}
              trailingIcon="arrowRight"
              between
              onPress={() => void submitEmail()}
              busy={busy}
              disabled={!email.trim()}
              style={{ marginTop: space.xs }}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <Field
              label={t("auth.code")}
              value={code}
              onChangeText={(text) => setCode(cleanCode(text))}
              placeholder={t("auth.codePlaceholder")}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              mono
              autoFocus
            />
            <Field
              label={t("auth.newPassword")}
              value={password}
              onChangeText={setPassword}
              placeholder={t("auth.passwordMin", { min: MIN_PASSWORD })}
              secureTextEntry={!reveal}
              autoComplete="new-password"
              textContentType="newPassword"
              onSubmitEditing={() => void submitReset()}
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
            />
            <View style={styles.links}>
              {link(t("auth.changeEmail"), () => setStep("email"))}
              {link(
                cooldown.seconds > 0 ? t("auth.resendIn", { seconds: cooldown.seconds }) : t("auth.resend"),
                () => void send(),
                cooldown.seconds > 0,
              )}
            </View>
            <Button
              label={t("auth.resetAndLogin")}
              trailingIcon="arrowRight"
              between
              onPress={() => void submitReset()}
              busy={busy}
              disabled={!ready}
              style={{ marginTop: space.xs }}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.page }}
    >
      <AuthSplit form={form} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.page, paddingTop: space.l, paddingBottom: space.xxl, gap: space.xl },
  centered: { flexGrow: 1, justifyContent: "center" },
  big: { fontSize: 34, lineHeight: 42, fontWeight: "900", letterSpacing: -0.7 },
  lead: { fontSize: 15, lineHeight: 24 },
  form: { gap: space.l },
  links: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.xs },
  link: { height: 36, justifyContent: "center" },
});
