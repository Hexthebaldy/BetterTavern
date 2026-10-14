/**
 * 一个密钥的详情：选模型（可从服务商拉取列表）、测试模型、设为导演模型、更换 Key、删除。
 */

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../../src/api/client.ts";
import type { ModelInfo, ProbeReport } from "../../../src/api/types.ts";
import {
  Body,
  Button,
  Caption,
  Centered,
  Field,
  GroupLabel,
  ListRow,
  Loading,
  Notice,
  Page,
} from "../../../src/components/ui.tsx";
import {
  CHECK_NAMES,
  CREDENTIAL_STATUS,
  credentialTitle,
  describeWindow,
  providerName,
} from "../../../src/features/settings/labels.ts";
import { useAsync } from "../../../src/hooks/useAsync.ts";
import { useApp } from "../../../src/state/AppProvider.tsx";
import { space, type, usePalette } from "../../../src/theme/index.ts";
import { formatTokens } from "../../../src/utils/format.ts";

const MAX_LISTED = 40;

function ProbeResult({ report }: { report: ProbeReport }) {
  const palette = usePalette();
  return (
    <View style={styles.probe}>
      {report.fatal_error ? <Notice message={report.fatal_error} /> : null}
      {report.checks.map((check) => (
        <View key={check.name} style={styles.check}>
          <Text
            style={[
              type.body,
              styles.mark,
              {
                color:
                  check.ok === true ? palette.accent : check.ok === false ? palette.danger : palette.muted,
              },
            ]}
          >
            {check.ok === true ? "✓" : check.ok === false ? "✗" : "–"}
          </Text>
          <View style={{ flex: 1 }}>
            <Body>{CHECK_NAMES[check.name] ?? check.name}</Body>
            <Caption>
              {check.detail}
              {check.latency_ms !== null ? `（${check.latency_ms} 毫秒）` : ""}
            </Caption>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function CredentialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const { data, error, loading, reload, setData } = useAsync(async () => {
    const [credential, providers, routes] = await Promise.all([
      api.credentials.get(id),
      api.credentials.providers(),
      api.routes.list(),
    ]);
    return { credential, providers, director: routes.find((r) => r.task === "director") ?? null };
  }, [api, id]);

  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [listing, setListing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [newKey, setNewKey] = useState("");
  const [updatingKey, setUpdatingKey] = useState(false);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = model.trim().toLowerCase();
    return (q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models).slice(0, MAX_LISTED);
  }, [models, model]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <Centered>
        <Body style={{ marginBottom: space.l, textAlign: "center" }}>{describeError(error)}</Body>
        <Button label="重新加载" onPress={() => void reload()} />
      </Centered>
    );
  }
  const { credential, providers, director } = data;
  const chosen = model.trim();

  const listModels = async (): Promise<void> => {
    setListing(true);
    setMessage(null);
    try {
      const list = await api.credentials.models(credential.id);
      setModels(list);
      if (list.length === 0) setMessage({ tone: "info", text: "服务商没有返回模型列表，可以直接填写模型名" });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setListing(false);
    }
  };

  const probe = async (): Promise<void> => {
    setProbing(true);
    setMessage(null);
    setReport(null);
    try {
      setReport(await api.credentials.probe(credential.id, chosen));
      const fresh = await api.credentials.get(credential.id);
      setData((current) => (current ? { ...current, credential: fresh } : current));
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setProbing(false);
    }
  };

  const useForDirector = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      const route = await api.routes.put("director", {
        credential_id: credential.id,
        model: chosen,
        params: director?.params ?? {},
      });
      setData((current) => (current ? { ...current, director: route } : current));
      setMessage({
        tone: "info",
        text: `导演模型已设为 ${route.model}。${describeWindow(route.window).join("；")}`,
      });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  const replaceKey = async (): Promise<void> => {
    setUpdatingKey(true);
    setMessage(null);
    try {
      const updated = await api.credentials.update(credential.id, { api_key: newKey.trim() });
      setNewKey("");
      setData((current) => (current ? { ...current, credential: updated } : current));
      setMessage({ tone: "info", text: `Key 已更换，尾号 ${updated.key_last4}` });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setUpdatingKey(false);
    }
  };

  const remove = (): void => {
    Alert.alert("删除这个密钥？", "用到它的模型分配会失效，需要重新选择。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          api.credentials
            .remove(credential.id)
            .then(() => router.back())
            .catch((e: unknown) => Alert.alert("删除失败", describeError(e)));
        },
      },
    ]);
  };

  const isDirector = director?.credential_id === credential.id;
  return (
    <Page>
      <Stack.Screen options={{ title: credentialTitle(credential, providers) }} />
      <Body>
        {providerName(credential.provider, providers)}，尾号 {credential.key_last4}，
        {CREDENTIAL_STATUS[credential.status]}
      </Body>
      {credential.base_url ? <Caption style={{ marginTop: space.xs }}>{credential.base_url}</Caption> : null}
      {isDirector && director ? (
        <Caption style={{ marginTop: space.xs, color: palette.accent }}>
          正在用作导演模型：{director.model}
        </Caption>
      ) : null}

      <GroupLabel>选择模型</GroupLabel>
      {message ? <Notice tone={message.tone} message={message.text} /> : null}
      <Field
        label="模型"
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={credential.provider === "deepseek" ? "例如 deepseek-chat" : "填写模型名，或从列表里选"}
      />
      {models === null ? (
        <Button label="获取模型列表" variant="secondary" onPress={() => void listModels()} busy={listing} />
      ) : (
        <View>
          {filtered.map((m) => (
            <ListRow
              key={m.id}
              title={m.id}
              detail={m.context_window ? formatTokens(m.context_window) : undefined}
              onPress={() => setModel(m.id)}
            />
          ))}
          {models.length > filtered.length ? (
            <Caption style={{ marginTop: space.s }}>共 {models.length} 个模型，输入名称筛选</Caption>
          ) : null}
        </View>
      )}
      <View style={styles.actions}>
        <Button
          label="测试这个模型"
          variant="secondary"
          onPress={() => void probe()}
          busy={probing}
          disabled={!chosen}
          style={{ flex: 1 }}
        />
        <Button
          label="设为导演模型"
          onPress={() => void useForDirector()}
          busy={saving}
          disabled={!chosen}
          style={{ flex: 1 }}
        />
      </View>
      {probing ? <Caption style={{ marginTop: space.s }}>会真的调用几次模型，大约需要半分钟</Caption> : null}
      {report ? <ProbeResult report={report} /> : null}

      {credential.probed_models.length > 0 ? (
        <>
          <GroupLabel>测试过的模型</GroupLabel>
          {credential.probed_models.map((m) => (
            <ListRow
              key={m.model}
              title={m.model}
              subtitle={m.ok ? "测试通过" : (m.fatal_error ?? "部分功能不可用")}
              onPress={() => setModel(m.model)}
            />
          ))}
        </>
      ) : null}

      <GroupLabel>更换 Key</GroupLabel>
      <Field
        label="新的 API Key"
        value={newKey}
        onChangeText={setNewKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        label="更换"
        variant="secondary"
        onPress={() => void replaceKey()}
        busy={updatingKey}
        disabled={!newKey.trim()}
      />

      <Button label="删除密钥" variant="danger" onPress={remove} style={{ marginTop: space.xxl }} />
    </Page>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: space.m, marginTop: space.l },
  probe: { marginTop: space.l },
  check: { flexDirection: "row", gap: space.m, marginBottom: space.m },
  mark: { width: 18, textAlign: "center" },
});
