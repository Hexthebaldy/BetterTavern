/** 登录。服务器地址在页面底部更改；连不上服务器时自动打开服务器面板。 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, describeError } from "../../src/api/client.ts";
import { Logo } from "../../src/components/Logo.tsx";
import { ServerRow, ServerSheet } from "../../src/components/ServerSetting.tsx";
import { Button, Field, Icon, IconButton, Notice } from "../../src/components/ui.tsx";
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      {error ? (
        <Notice
          banner
          message={error}
          style={{ paddingTop: insets.top + 14 }}
          onClose={() => setError(null)}
        />
      ) : null}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: (error ? 0 : insets.top) + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Logo />
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
            继续你的故事
          </Text>
          <Text style={[styles.lead, { color: palette.mut }]}>导入一张角色卡，用第一人称把故事写下去。</Text>
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
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="还没有账户？注册"
            onPress={() => router.replace("/register")}
            style={({ pressed }) => [
              styles.switch,
              { borderColor: palette.line2, backgroundColor: pressed ? palette.bg2 : palette.bg },
            ]}
          >
            <Text style={{ fontSize: 15, color: palette.ink }}>还没有账户？</Text>
            <View style={styles.switchAction}>
              <Text style={{ fontSize: 15, fontWeight: "500", color: palette.ink }}>注册</Text>
              <Icon name="arrowRight" size={18} />
            </View>
          </Pressable>
        </View>
      </ScrollView>
      <ServerRow onChange={() => setServerOpen(true)} />
      <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.read, paddingBottom: space.xxl, gap: space.xxl },
  big: { fontSize: 34, lineHeight: 42, fontWeight: "700", letterSpacing: -0.7 },
  lead: { fontSize: 15, lineHeight: 24 },
  form: { gap: 18 },
  switch: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 52,
    paddingHorizontal: space.page,
    borderWidth: 1,
  },
  switchAction: { flexDirection: "row", alignItems: "center", gap: 6 },
});
