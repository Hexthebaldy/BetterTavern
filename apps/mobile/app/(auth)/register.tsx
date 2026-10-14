/** 注册：邮箱、密码（至少 8 位）、可选的昵称 */

import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, describeError } from "../../src/api/client.ts";
import { ServerSetting } from "../../src/components/ServerSetting.tsx";
import { Button, Caption, Field, Notice, Page, Title } from "../../src/components/ui.tsx";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";

const MIN_PASSWORD = 8;

export default function RegisterScreen() {
  const { api, signIn } = useApp();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      await signIn(await api.auth.register({ email: email.trim(), password, display_name: name.trim() }));
    } catch (e) {
      const field = e instanceof ApiError ? e.field("field") : undefined;
      if (typeof field === "string") setFieldError({ field, message: describeError(e) });
      else setError(describeError(e));
      setBusy(false);
    }
  };

  const errorFor = (field: string): string | null =>
    fieldError?.field === field ? fieldError.message : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: palette.paper }}>
      <Page contentStyle={{ paddingTop: insets.top + space.xxl * 2 }}>
        <Title style={{ marginBottom: space.xl }}>注册</Title>
        {error ? <Notice message={error} /> : null}
        <Field
          label="邮箱"
          value={email}
          onChangeText={setEmail}
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
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          hint={`至少 ${MIN_PASSWORD} 位`}
          error={errorFor("password") ?? (tooShort ? `至少 ${MIN_PASSWORD} 位` : null)}
        />
        <Field
          label="昵称（可选）"
          value={name}
          onChangeText={setName}
          maxLength={40}
          onSubmitEditing={submit}
        />
        <Button
          label="注册并登录"
          onPress={submit}
          busy={busy}
          disabled={!email.trim() || password.length < MIN_PASSWORD}
        />
        <View style={styles.switch}>
          <Caption>已经有账户？</Caption>
          <Link href="/login" replace>
            <Caption style={{ color: palette.accent }}>登录</Caption>
          </Link>
        </View>
        <ServerSetting />
      </Page>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: "row", justifyContent: "center", marginTop: space.xl, gap: space.xs },
});
