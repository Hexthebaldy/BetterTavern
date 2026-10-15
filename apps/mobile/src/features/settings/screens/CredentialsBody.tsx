/**
 * 密钥与端点：列出已添加的密钥，下面是添加表单（DeepSeek、Hugging Face 或任意 OpenAI 兼容端点）。
 * Key 只在这里输入一次，经 TLS 发给服务端加密保存；之后界面只显示后四位，设备上不保存。
 * 路由页面是 app/settings/credentials.tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../../api/client.ts";
import type { Credential, ModelRoute, Provider } from "../../../api/types.ts";
import { KeyField, ProviderMark } from "../../../components/KeyParts.tsx";
import {
  Button,
  CheckMark,
  ErrorState,
  Field,
  Group,
  Icon,
  Loading,
  Notice,
  Pill,
  SectionHeader,
  Status,
  useColumnStyle,
} from "../../../components/ui.tsx";
import { CREDENTIAL_STATUS, credentialTitle, providerMark, statusKind } from "../labels.ts";
import { useAsync } from "../../../hooks/useAsync.ts";
import { SettingsBack, useSettingsNav } from "../nav.tsx";
import { useApp } from "../../../state/AppProvider.tsx";
import { font, space, usePalette } from "../../../theme/index.ts";

function KeyRow({
  credential,
  providers,
  director,
  onPress,
}: {
  credential: Credential;
  providers: Provider[];
  director: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.bg3 : "transparent" }]}
    >
      <ProviderMark mark={providerMark(credential.provider)} tone={director ? "ink" : "card"} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 16, lineHeight: 22, fontWeight: "500", color: palette.ink }}
        >
          {credentialTitle(credential, providers)}
        </Text>
        <View style={styles.meta}>
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mut }}>
            •••• {credential.key_last4}
          </Text>
          <Status kind={statusKind(credential.status)} label={CREDENTIAL_STATUS[credential.status]} />
        </View>
      </View>
      {director ? (
        <Pill label="导演" tone="acc" height={26} />
      ) : (
        <Icon name="chevronRight" size={18} color={palette.mut} />
      )}
    </Pressable>
  );
}

function ProviderTile({
  provider,
  selected,
  onPress,
}: {
  provider: Provider;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={provider.display_name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        selected
          ? { backgroundColor: palette.accBg, boxShadow: `inset 0 0 0 2px ${palette.acc}` }
          : { backgroundColor: palette.card },
        { transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      <ProviderMark mark={providerMark(provider.id)} size={36} tone={selected ? "acc" : "grey"} />
      <Text style={{ fontSize: 13.5, lineHeight: 18, color: palette.ink }}>
        {provider.requires_base_url ? "自定义兼容端点" : provider.display_name}
      </Text>
    </Pressable>
  );
}

function AddCredential({ providers, onAdded }: { providers: Provider[]; onAdded: (c: Credential) => void }) {
  const { api } = useApp();
  const palette = usePalette();
  const [provider, setProvider] = useState(providers[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [official, setOfficial] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = providers.find((p) => p.id === provider);
  const needsUrl = selected?.requires_base_url ?? false;
  const useOfficial = official && !needsUrl;

  useEffect(() => {
    setOfficial(true);
  }, [provider]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.credentials.create({
        provider,
        label: label.trim(),
        api_key: key.trim(),
        base_url: useOfficial ? null : baseUrl.trim() || null,
      });
      setKey("");
      setLabel("");
      setBaseUrl("");
      onAdded(created);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.form, { backgroundColor: palette.bg2 }]}>
      {error ? <Notice message={error} /> : null}
      <View style={{ gap: space.s }}>
        <Text style={[styles.label, { color: palette.ink2 }]}>服务商</Text>
        <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel="服务商">
          {providers.map((p) => (
            <ProviderTile
              key={p.id}
              provider={p}
              selected={p.id === provider}
              onPress={() => setProvider(p.id)}
            />
          ))}
        </View>
      </View>
      <KeyField
        label="API Key"
        onGrey
        value={key}
        onChangeText={setKey}
        placeholder="sk-…"
        hint="只发送这一次，之后只显示后四位。"
        hintIcon="lock"
      />
      <View style={{ gap: space.s }}>
        <Text style={[styles.label, { color: palette.ink2 }]}>端点地址</Text>
        {needsUrl ? null : (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: official }}
            onPress={() => setOfficial((v) => !v)}
            style={[styles.official, { backgroundColor: palette.card }]}
          >
            <CheckMark checked={official} />
            <Text style={{ fontSize: 15, color: palette.ink }}>使用官方地址</Text>
          </Pressable>
        )}
        {useOfficial ? null : (
          <Field
            label="端点地址"
            hideLabel
            onGrey
            value={baseUrl}
            onChangeText={setBaseUrl}
            mono
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={selected?.default_base_url ?? "https://example.com/v1"}
          />
        )}
        <Text style={[styles.note, { color: palette.mut }]}>
          {needsUrl
            ? "OpenAI 兼容接口的地址，通常以 /v1 结尾。"
            : "取消勾选会出现地址输入框；选“自定义兼容端点”时必须填写。"}
        </Text>
      </View>
      <Field
        label="备注名"
        optional
        onGrey
        value={label}
        onChangeText={setLabel}
        maxLength={60}
        placeholder={`我的 ${selected?.display_name ?? ""}`.trim()}
      />
      <Button
        label="保存密钥"
        trailingIcon="arrowRight"
        between
        onPress={() => void save()}
        busy={busy}
        disabled={!key.trim() || (!useOfficial && !baseUrl.trim())}
      />
    </View>
  );
}

export function CredentialsBody() {
  const { api } = useApp();
  const nav = useSettingsNav();
  const column = useColumnStyle();
  const palette = usePalette();
  const { data, error, loading, reload } = useAsync(async () => {
    const [providers, credentials, routes] = await Promise.all([
      api.credentials.providers(),
      api.credentials.list(),
      api.routes.list().catch((): ModelRoute[] => []),
    ]);
    return { providers, credentials, director: routes.find((r) => r.task === "director") ?? null };
  }, [api]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <SettingsBack />
        <ErrorState title="密钥列表没加载出来" message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }
  const { providers, credentials, director } = data;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.big, { color: palette.ink }]}>
            密钥与端点
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, color: palette.mut }}>
            故事由你自己的模型来写。添加一个密钥，再挑一个模型当导演。
          </Text>
        </View>
        {error ? (
          <Notice
            icon="offline"
            message={describeError(error)}
            actionLabel="重试"
            onAction={() => void reload()}
            style={styles.inset}
          />
        ) : null}
        {credentials.length > 0 ? (
          <Group inset={70} style={styles.inset}>
            {credentials.map((c) => (
              <KeyRow
                key={c.id}
                credential={c}
                providers={providers}
                director={director?.credential_id === c.id}
                onPress={() => nav.open({ screen: "credential", id: c.id })}
              />
            ))}
          </Group>
        ) : null}
        <SectionHeader title="添加密钥" />
        {providers.length > 0 ? (
          <AddCredential
            providers={providers}
            onAdded={(created) => {
              void reload();
              nav.open({ screen: "credential", id: created.id });
            }}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.page, paddingTop: space.l, paddingBottom: 18, gap: space.s },
  big: { fontSize: 32, lineHeight: 40, fontWeight: "700", letterSpacing: -0.64 },
  inset: { marginHorizontal: space.list },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 72, padding: 14 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  form: {
    marginHorizontal: space.list,
    paddingVertical: space.l,
    paddingHorizontal: space.m,
    borderRadius: 30,
    gap: 22,
  },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500", paddingLeft: space.xs },
  tiles: { flexDirection: "row", gap: 6 },
  tile: {
    flex: 1,
    minHeight: 112,
    padding: 14,
    borderRadius: 22,
    justifyContent: "space-between",
    gap: space.l,
  },
  official: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    height: 52,
    paddingHorizontal: space.l,
    borderRadius: 16,
  },
  note: { fontSize: 12.5, lineHeight: 18, paddingLeft: space.xs },
});
