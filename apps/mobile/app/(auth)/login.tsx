/**
 * 登录。服务器地址在页面底部更改；连不上服务器时自动打开服务器面板。
 * 平板（components/AuthLayout.tsx）：宽屏左边是插画区、表单在右半边居中；中屏表单宽 440 居中。
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, describeError } from "@bettertavern/core/api/client";

import { AuthSplit, useAuthColumn, useAuthFormWidth } from "../../src/components/AuthLayout.tsx";
import { Logo } from "../../src/components/Logo.tsx";
import { ServerRow, ServerSheet } from "../../src/components/ServerSetting.tsx";
import { Button, Field, IconButton, Notice } from "../../src/components/ui.tsx";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";

export default function LoginScreen() {
  const { api, signIn, serverUrl } = useApp();
  const { serverUsed, serverFailed } = usePrefs();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const { compact, expanded } = useLayout();
  const column = useAuthColumn();
  const formWidth = useAuthFormWidth();

  const submit = async (): Promise<void> => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await api.auth.login({ email: email.trim(), password });
      serverUsed(serverUrl);
      await signIn(auth);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.isNetwork) {
        serverFailed(serverUrl);
        setError("连不上服务器，检查地址或网络。");
        setServerOpen(true);
      } else {
        setError(describeError(e));
      }
    }
  };

  const form = (
    <View style={{ flex: 1 }}>
      {error ? (
        // 平板上和表单一样宽，在表单那一栏里居中
        <View
          pointerEvents="box-none"
          style={[styles.error, { top: insets.top + space.s }, formWidth ? styles.errorRow : null]}
        >
          <Notice
            floating
            message={error}
            onClose={() => setError(null)}
            style={formWidth ? { width: formWidth } : null}
          />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.l },
          // 平板上表单限宽、在页面中间
          compact ? null : styles.centered,
          column,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 宽屏的 Logo 和介绍在左边的插画区里 */}
        {expanded ? null : <Logo />}
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
            继续你的故事
          </Text>
          {expanded ? null : (
            <Text style={[styles.lead, { color: palette.mut }]}>
              导入一张角色卡，用第一人称把故事写下去。
            </Text>
          )}
        </View>
        <View style={styles.form}>
          <Field
            label="邮箱"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
          />
          <Field
            label="密码"
            value={password}
            onChangeText={setPassword}
            placeholder="输入密码"
            secureTextEntry={!reveal}
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={() => void submit()}
            trailing={
              <IconButton
                icon={reveal ? "eyeOff" : "eye"}
                label={reveal ? "隐藏密码" : "显示密码"}
                tone="plain"
                diameter={44}
                color={palette.mut}
                onPress={() => setReveal((r) => !r)}
              />
            }
          />
          <Button
            label="登录"
            trailingIcon="arrowRight"
            between
            onPress={() => void submit()}
            busy={busy}
            disabled={!email.trim() || !password}
            style={{ marginTop: space.s }}
          />
          <View style={styles.switch}>
            <Text style={{ fontSize: 14, color: palette.mut }}>还没有账户？</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="注册"
              onPress={() => router.replace("/register")}
              hitSlop={8}
              style={styles.switchAction}
            >
              <Text style={{ fontSize: 14, fontWeight: "500", color: palette.acc }}>注册</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <AuthSplit form={form} footer={<ServerRow onChange={() => setServerOpen(true)} width={formWidth} />} />
      <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  error: { position: "absolute", zIndex: 4, left: space.l, right: space.l },
  errorRow: { left: 0, right: 0, alignItems: "center" },
  content: { paddingHorizontal: space.page, paddingTop: space.xl, paddingBottom: space.xxl, gap: 32 },
  centered: { flexGrow: 1, justifyContent: "center" },
  big: { fontSize: 32, lineHeight: 40, fontWeight: "700", letterSpacing: -0.64 },
  lead: { fontSize: 15, lineHeight: 24 },
  form: { gap: space.l },
  switch: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  switchAction: { height: 44, justifyContent: "center", paddingHorizontal: 6 },
});
