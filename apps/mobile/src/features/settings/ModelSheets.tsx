/**
 * 模型详情页的面板：编辑（备注名、模型名、端点）、更换 Key、填写上下文窗口。
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoutePatch } from "@bettertavern/core/api/endpoints";
import type { ModelRoute, Provider } from "@bettertavern/core/api/types";
import { MANUAL_WINDOW_CHOICES, manualWindowChoice } from "@bettertavern/core/settings/labels";

import { KeyField } from "../../components/KeyParts.tsx";
import { Button, CheckMark, Field, Notice, Segmented, Sheet } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { radius, space, usePalette } from "../../theme/index.ts";

function OfficialToggle({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={[styles.official, { backgroundColor: palette.bg2 }]}
    >
      <CheckMark checked={checked} />
      <Text style={{ fontSize: 15, color: palette.ink }}>使用官方地址</Text>
    </Pressable>
  );
}

export function EditSheet({
  visible,
  onClose,
  route,
  provider,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  route: ModelRoute;
  provider: Provider | undefined;
  onSaved: (r: ModelRoute) => void;
}) {
  const { api } = useApp();
  const palette = usePalette();
  const needsUrl = provider?.requires_base_url ?? false;
  const [label, setLabel] = useState(route.label);
  const [model, setModel] = useState(route.model);
  const [official, setOfficial] = useState(!route.base_url);
  const [baseUrl, setBaseUrl] = useState(route.base_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLabel(route.label);
    setModel(route.model);
    setOfficial(!route.base_url);
    setBaseUrl(route.base_url ?? "");
    setError(null);
  }, [visible, route]);

  const useOfficial = official && !needsUrl;
  const nextUrl = useOfficial ? null : baseUrl.trim();
  const urlChanged = useOfficial ? route.base_url !== null : nextUrl !== (route.base_url ?? "");
  const modelChanged = model.trim() !== route.model;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const patch: ModelRoutePatch = {};
      if (label.trim() !== route.label) patch.label = label.trim();
      if (modelChanged) patch.model = model.trim();
      if (urlChanged) patch.base_url = nextUrl ?? "";
      onSaved(Object.keys(patch).length > 0 ? await api.models.update(route.id, patch) : route);
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="编辑模型">
      <View style={styles.sheetBody}>
        {error ? <Notice message={error} /> : null}
        <Field
          label="备注名"
          optional
          value={label}
          onChangeText={setLabel}
          maxLength={60}
          placeholder={route.model}
        />
        <Field
          label="模型名"
          value={model}
          onChangeText={setModel}
          mono
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={200}
        />
        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: palette.ink2 }]}>端点地址</Text>
          {needsUrl ? null : <OfficialToggle checked={official} onToggle={() => setOfficial((v) => !v)} />}
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
        </View>
        {urlChanged || modelChanged ? (
          <Text style={{ fontSize: 12.5, lineHeight: 18, color: palette.warn }}>
            换了{modelChanged ? "模型名" : "端点"}，之前的测试结果和上下文窗口会重新确定。
          </Text>
        ) : null}
        <Button
          label="保存"
          onPress={() => void save()}
          busy={busy}
          disabled={!model.trim() || (!useOfficial && !baseUrl.trim())}
        />
      </View>
    </Sheet>
  );
}

export function ReplaceKeySheet({
  visible,
  onClose,
  route,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  route: ModelRoute;
  onSaved: (r: ModelRoute) => void;
}) {
  const { api } = useApp();
  const palette = usePalette();
  const shared = route.shares_key_with.length;
  const [key, setKey] = useState("");
  const [together, setTogether] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setKey("");
      setTogether(true);
      setError(null);
    }
  }, [visible]);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.models.update(route.id, {
          api_key: key.trim(),
          apply_to_same_key: shared > 0 && together,
        }),
      );
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
          hint={`现在的尾号 ${route.key_last4}。换了之后测试结果会清空。`}
          hintIcon="lock"
        />
        {shared > 0 ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: together }}
            onPress={() => setTogether((v) => !v)}
            style={[styles.official, { backgroundColor: palette.bg2 }]}
          >
            <CheckMark checked={together} />
            <Text style={{ flex: 1, fontSize: 15, color: palette.ink }}>
              另外 {shared} 个模型也用这个 Key，一起换
            </Text>
          </Pressable>
        ) : null}
        <Button label="更换" onPress={() => void save()} busy={busy} disabled={!key.trim()} />
      </View>
    </Sheet>
  );
}

export function WindowSheet({
  visible,
  onClose,
  route,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  route: ModelRoute;
  onSaved: (r: ModelRoute) => void;
}) {
  const { api } = useApp();
  const palette = usePalette();
  const [choice, setChoice] = useState(manualWindowChoice(route.manual_window));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setChoice(manualWindowChoice(route.manual_window));
      setError(null);
    }
  }, [visible, route]);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const tokens = MANUAL_WINDOW_CHOICES.find((c) => c.value === choice)?.tokens ?? null;
      onSaved(await api.models.update(route.id, { manual_window: tokens }));
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="上下文窗口">
      <View style={styles.sheetBody}>
        {error ? <Notice message={error} /> : null}
        <Text style={{ fontSize: 14, lineHeight: 22, color: palette.ink2 }}>
          这个模型一次最多能读多少 token。服务商的说明页一般会写；不知道就选“不知道”，先按 32K 估计。
        </Text>
        <Segmented
          value={choice}
          options={MANUAL_WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
          onChange={setChoice}
          mono
        />
        <Button label="保存" onPress={() => void save()} busy={busy} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  official: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 52,
    paddingHorizontal: space.l,
    borderRadius: radius.input,
  },
  label: { fontSize: 13, fontWeight: "500", paddingLeft: space.xs },
  sheetBody: { paddingHorizontal: space.l, paddingBottom: space.s, gap: space.l },
});
