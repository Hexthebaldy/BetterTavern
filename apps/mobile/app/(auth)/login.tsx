/** 登录。服务器地址可以在这里改（连局域网里的开发服务器时用）。 */

import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeError } from "../../src/api/client.ts";
import { ServerSetting } from "../../src/components/ServerSetting.tsx";
import { Body, Button, Caption, Field, Notice, Page } from "../../src/components/ui.tsx";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";

export default function LoginScreen() {
  const { api, signIn } = useApp();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await signIn(await api.auth.login({ email: email.trim(), password }));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: palette.paper }}>
      <Page contentStyle={{ paddingTop: insets.top + space.xxl * 2 }}>
        <Text style={[styles.brand, { color: palette.ink }]}>BetterTavern</Text>
        <Body style={{ color: palette.muted, marginBottom: space.xxl }}>
          导入一张角色卡，用第一人称把故事写下去。
        </Body>
        {error ? <Notice message={error} /> : null}
        <Field
          label="邮箱"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
        />
        <Field
          label="密码"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
        />
        <Button label="登录" onPress={submit} busy={busy} disabled={!email.trim() || !password} />
        <View style={styles.switch}>
          <Caption>还没有账户？</Caption>
          <Link href="/register" replace>
            <Caption style={{ color: palette.accent }}>注册</Caption>
          </Link>
        </View>
        <ServerSetting />
      </Page>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 34, lineHeight: 42, fontWeight: "700", letterSpacing: -0.5, marginBottom: space.s },
  switch: { flexDirection: "row", justifyContent: "center", marginTop: space.xl, gap: space.xs },
});
