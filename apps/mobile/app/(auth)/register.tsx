/** 注册：邮箱、密码（至少 8 位，下面一条 8 格的长度条）、可选的昵称 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "../../src/api/client.ts";
import { ServerRow, ServerSheet } from "../../src/components/ServerSetting.tsx";
import { BackBar, Button, Field, IconButton, Notice } from "../../src/components/ui.tsx";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { font, space, usePalette } from "../../src/theme/index.ts";

const MIN_PASSWORD = 8;
const NAME_MAX = 40;

function LengthBar({ length }: { length: number }) {
  const palette = usePalette();
  const enough = length >= MIN_PASSWORD;
  return (
    <View style={{ gap: space.s }} accessibilityLabel={`已输入 ${length} 位，至少 ${MIN_PASSWORD} 位`}>
      <View style={styles.bar}>
        {Array.from({ length: MIN_PASSWORD }, (_, i) => (
          <View
            key={i}
            style={[styles.cell, { backgroundColor: i < length ? palette.ink : palette.line2 }]}
          />
        ))}
      </View>
      <Text style={[styles.meta, { color: palette.mut }]}>
        {enough ? `${length} 位 · 长度够了` : `${length} / ${MIN_PASSWORD} · 至少 ${MIN_PASSWORD} 位`}
      </Text>
    </View>
  );
}

export default function RegisterScreen() {
  const { api, signIn, serverUrl } = useApp();
  const { serverUsed, serverFailed } = usePrefs();
  const palette = usePalette();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [serverOpen, setServerOpen] = useState(false);

  const ready = !!email.trim() && password.length >= MIN_PASSWORD;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const auth = await api.auth.register({ email: email.trim(), password, display_name: name.trim() });
      serverUsed(serverUrl);
      await signIn(auth);
    } catch (e) {
      setBusy(false);
      const field = e instanceof ApiError ? e.field("field") : undefined;
      if (typeof field === "string") setFieldError({ field, message: describeError(e) });
      else if (e instanceof ApiError && e.isNetwork) {
        serverFailed(serverUrl);
        setError("连不上服务器，检查地址或网络。");
        setServerOpen(true);
      } else setError(describeError(e));
    }
  };

  const errorFor = (field: string): string | null =>
    fieldError?.field === field ? fieldError.message : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <BackBar onBack={() => router.replace("/login")} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
          创建账户
        </Text>
        {error ? <Notice message={error} /> : null}
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
            error={errorFor("email")}
          />
          <Field
            label="密码"
            value={password}
            onChangeText={setPassword}
            placeholder={`至少 ${MIN_PASSWORD} 位`}
            secureTextEntry={!reveal}
            autoComplete="new-password"
            textContentType="newPassword"
            error={errorFor("password")}
            trailing={
              <IconButton
                icon={reveal ? "eyeOff" : "eye"}
                label={reveal ? "隐藏密码" : "显示密码"}
                color={palette.mut}
                onPress={() => setReveal((r) => !r)}
              />
            }
            below={password.length > 0 ? <LengthBar length={password.length} /> : null}
          />
          <Field
            label="昵称"
            optional
            counter
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            onSubmitEditing={() => void submit()}
          />
          <Button
            label="注册并登录"
            trailingIcon="arrowRight"
            between
            onPress={() => void submit()}
            busy={busy}
            disabled={!ready}
            style={{ marginTop: space.xs }}
          />
        </View>
      </ScrollView>
      <ServerRow onChange={() => setServerOpen(true)} />
      <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.read, paddingTop: space.s, paddingBottom: space.xxl, gap: space.xl },
  big: { fontSize: 34, lineHeight: 42, fontWeight: "700", letterSpacing: -0.7 },
  form: { gap: space.page },
  bar: { flexDirection: "row", gap: 3 },
  cell: { flex: 1, height: 3 },
  meta: { fontFamily: font.mono, fontSize: 12, lineHeight: 16 },
});
