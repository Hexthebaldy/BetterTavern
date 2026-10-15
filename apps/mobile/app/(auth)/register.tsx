/**
 * 注册：邮箱、密码（至少 8 位，下面一条长度进度条）、可选的昵称。
 * 平板版式和登录一样（components/AuthLayout.tsx）：宽屏左边插画区，中屏表单宽 440 居中。
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "../../src/api/client.ts";
import { AuthSplit, useAuthColumn, useAuthFormWidth } from "../../src/components/AuthLayout.tsx";
import { ServerRow, ServerSheet } from "../../src/components/ServerSetting.tsx";
import { BackBar, Button, Field, IconButton, Notice } from "../../src/components/ui.tsx";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import { font, space, usePalette } from "../../src/theme/index.ts";

const MIN_PASSWORD = 8;
const NAME_MAX = 40;

function LengthBar({ length }: { length: number }) {
  const palette = usePalette();
  const ratio = Math.min(length / MIN_PASSWORD, 1);
  return (
    <View style={styles.lengthRow} accessibilityLabel={`已输入 ${length} 位，至少 ${MIN_PASSWORD} 位`}>
      <View style={[styles.track, { backgroundColor: palette.bg3 }]}>
        <View
          style={[
            styles.fill,
            { width: `${ratio * 100}%`, backgroundColor: ratio >= 1 ? palette.ok : palette.ink },
          ]}
        />
      </View>
      <Text style={[styles.meta, { color: palette.mut }]}>
        {length >= MIN_PASSWORD ? `${length} 位` : `${length} / ${MIN_PASSWORD}`}
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
  const { compact } = useLayout();
  const column = useAuthColumn();
  const formWidth = useAuthFormWidth();

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

  const form = (
    <View style={{ flex: 1 }}>
      <BackBar onBack={() => router.replace("/login")} />
      <ScrollView
        contentContainerStyle={[styles.content, compact ? null : styles.centered, column]}
        keyboardShouldPersistTaps="handled"
      >
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
                tone="plain"
                diameter={44}
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
  content: { paddingHorizontal: space.page, paddingTop: space.l, paddingBottom: space.xxl, gap: space.xl },
  centered: { flexGrow: 1, justifyContent: "center" },
  big: { fontSize: 32, lineHeight: 40, fontWeight: "700", letterSpacing: -0.64 },
  form: { gap: 18 },
  lengthRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: space.xs },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  meta: { fontFamily: font.mono, fontSize: 12, lineHeight: 16 },
});
