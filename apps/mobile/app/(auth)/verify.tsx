/**
 * 验证邮箱：注册以后（服务器要求验证邮箱时）、没验证就登录时来这里。验证码已经发出，填对了直接登录。
 * 邮箱从上一页带过来（路由参数 email）；“重新发送”有 60 秒倒计时。同网页端 pages/auth/VerifyPage.tsx。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import { currentLanguage } from "@bettertavern/core/i18n/index";

import { AuthSplit, useAuthColumn } from "../../src/components/AuthLayout.tsx";
import { BackBar, Button, Field, Notice } from "../../src/components/ui.tsx";
import { cleanCode, codeErrorText, useCooldown } from "../../src/features/auth/parts.tsx";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, useComic } from "../../src/theme/index.ts";

export default function VerifyScreen() {
  const { api, signIn } = useApp();
  const c = useComic();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // 进来时验证码刚发过
  const cooldown = useCooldown(60);
  const { compact } = useLayout();
  const column = useAuthColumn();

  const submit = async (): Promise<void> => {
    if (code.length !== 6 || busy) return;
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

  const form = (
    <View style={{ flex: 1 }}>
      <BackBar onBack={() => router.replace("/login")} />
      <ScrollView
        contentContainerStyle={[styles.content, compact ? null : styles.centered, column]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={[styles.big, { color: c.ink }]}>
            {t("auth.verifyTitle")}
          </Text>
          <Text style={[styles.lead, { color: c.mut }]}>{t("auth.verifySent", { email })}</Text>
        </View>
        {error ? <Notice message={error} /> : null}
        {info ? <Notice tone="info" message={info} /> : null}
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
            onSubmitEditing={() => void submit()}
          />
          <View style={styles.resendRow}>
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: c.mut }}>{t("auth.checkSpam")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: cooldown.seconds > 0 }}
              disabled={cooldown.seconds > 0}
              onPress={() => void resend()}
              hitSlop={8}
              style={styles.resend}
            >
              <Text
                style={{ fontSize: 14, fontWeight: "700", color: cooldown.seconds > 0 ? c.mut : c.acc }}
              >
                {cooldown.seconds > 0 ? t("auth.resendIn", { seconds: cooldown.seconds }) : t("auth.resend")}
              </Text>
            </Pressable>
          </View>
          <Button
            label={t("auth.verifyAndLogin")}
            trailingIcon="arrowRight"
            between
            onPress={() => void submit()}
            busy={busy}
            disabled={code.length !== 6}
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
  resendRow: { flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: space.xs },
  resend: { height: 36, justifyContent: "center" },
});
