/**
 * 密钥详情页的两个面板：编辑备注名和端点、更换 Key。
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../api/client.ts";
import type { Credential, Provider } from "../../api/types.ts";
import { KeyField } from "../../components/KeyParts.tsx";
import { Button, CheckMark, Field, Notice, Sheet } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { space, usePalette } from "../../theme/index.ts";

export function EditSheet({
  visible,
  onClose,
  credential,
  provider,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  credential: Credential;
  provider: Provider | undefined;
  onSaved: (c: Credential) => void;
}) {
  const { api } = useApp();
  const palette = usePalette();
  const needsUrl = provider?.requires_base_url ?? false;
  const [label, setLabel] = useState(credential.label);
  const [official, setOfficial] = useState(!credential.base_url);
  const [baseUrl, setBaseUrl] = useState(credential.base_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLabel(credential.label);
    setOfficial(!credential.base_url);
    setBaseUrl(credential.base_url ?? "");
    setError(null);
  }, [visible, credential]);

  const useOfficial = official && !needsUrl;
  const nextUrl = useOfficial ? null : baseUrl.trim();
  const urlChanged = useOfficial ? credential.base_url !== null : nextUrl !== (credential.base_url ?? "");

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const patch: { label?: string; base_url?: string } = {};
      if (label.trim() && label.trim() !== credential.label) patch.label = label.trim();
      if (urlChanged) patch.base_url = nextUrl ?? "";
      onSaved(
        Object.keys(patch).length > 0 ? await api.credentials.update(credential.id, patch) : credential,
      );
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="编辑密钥">
      <View style={styles.sheetBody}>
        {error ? <Notice message={error} /> : null}
        <Field
          label="备注名"
          value={label}
          onChangeText={setLabel}
          maxLength={60}
          placeholder={provider?.display_name}
        />
        <View style={{ gap: space.s }}>
          <Text style={{ fontSize: 13, fontWeight: "500", color: palette.ink2 }}>端点地址</Text>
          {needsUrl ? null : (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: official }}
              onPress={() => setOfficial((v) => !v)}
              style={[styles.official, { backgroundColor: palette.bg2, borderColor: palette.line }]}
            >
              <CheckMark checked={official} />
              <Text style={{ fontSize: 15, color: palette.ink }}>使用官方地址</Text>
            </Pressable>
          )}
          {useOfficial ? null : (
            <Field
              label="端点地址"
              hideLabel
              value={baseUrl}
              onChangeText={setBaseUrl}
              mono
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={provider?.default_base_url ?? "https://example.com/v1"}
            />
          )}
          {urlChanged ? (
            <Text style={{ fontSize: 12.5, lineHeight: 18, color: palette.warn }}>
              换了端点，之前的测试结果会清空，需要重新测试。
            </Text>
          ) : null}
        </View>
        <Button
          label="保存"
          onPress={() => void save()}
          busy={busy}
          disabled={!useOfficial && !baseUrl.trim()}
        />
      </View>
    </Sheet>
  );
}

export function ReplaceKeySheet({
  visible,
  onClose,
  credential,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  credential: Credential;
  onSaved: (c: Credential) => void;
}) {
  const { api } = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setKey("");
      setError(null);
    }
  }, [visible]);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.credentials.update(credential.id, { api_key: key.trim() }));
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="更换 Key">
      <View style={styles.sheetBody}>
        {error ? <Notice message={error} /> : null}
        <KeyField
          label="新的 API Key"
          value={key}
          onChangeText={setKey}
          placeholder="sk-…"
          hint={`现在的尾号 ${credential.key_last4}。换了之后要重新测试。`}
          hintIcon="lock"
        />
        <Button label="更换" onPress={() => void save()} busy={busy} disabled={!key.trim()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  official: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    height: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  sheetBody: { paddingHorizontal: space.page, paddingBottom: space.page, gap: space.l },
});
