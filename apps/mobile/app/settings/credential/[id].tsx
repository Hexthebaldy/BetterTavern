/**
 * 一个密钥的详情：进入页面时自动拉取模型列表，单选一个模型（搜索框兼做手动输入，见 ModelPicker），
 * 测试这个模型、设为导演模型；标题旁的铅笔改备注名和端点；更换 Key、删除（面板见 CredentialSheets）。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../../src/api/client.ts";
import type { Credential, ModelInfo, ModelRoute, ProbeReport } from "../../../src/api/types.ts";
import {
  BackBar,
  Button,
  ErrorState,
  IconButton,
  Loading,
  Notice,
  Pill,
  Status,
  useOverlay,
} from "../../../src/components/ui.tsx";
import { EditSheet, ReplaceKeySheet } from "../../../src/features/settings/CredentialSheets.tsx";
import {
  CREDENTIAL_STATUS,
  credentialTitle,
  describeWindow,
  providerName,
  statusKind,
} from "../../../src/features/settings/labels.ts";
import { ModelPicker } from "../../../src/features/settings/ModelPicker.tsx";
import { ProbedModels, ProbeResults } from "../../../src/features/settings/ProbeResults.tsx";
import { useAsync } from "../../../src/hooks/useAsync.ts";
import { useApp } from "../../../src/state/AppProvider.tsx";
import { font, space, usePalette } from "../../../src/theme/index.ts";

type Message = { tone: "error" | "info"; text: string };

// ---- 页面 -------------------------------------------------------------------------------

export default function CredentialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const overlay = useOverlay();
  const { data, error, loading, reload, setData } = useAsync(async () => {
    const [credential, providers, routes] = await Promise.all([
      api.credentials.get(id),
      api.credentials.providers(),
      api.routes.list(),
    ]);
    return { credential, providers, director: routes.find((r) => r.task === "director") ?? null };
  }, [api, id]);

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const listModels = useCallback(async (): Promise<void> => {
    setListing(true);
    setListError(null);
    try {
      const list = await api.credentials.models(id);
      setModels(list);
      if (list.length === 0) setListError("服务商没有返回模型列表");
    } catch (e) {
      setListError(describeError(e));
    } finally {
      setListing(false);
    }
  }, [api, id]);

  useEffect(() => {
    void listModels();
  }, [listModels]);

  const credential = data?.credential;
  const director = data?.director ?? null;
  const isDirector = !!credential && director?.credential_id === credential.id;
  // 没手动选过时，默认选中正在用作导演的模型
  const chosen = picked ?? (query.trim() || (isDirector ? (director?.model ?? "") : ""));

  if (loading && !data) return <Loading />;
  if (!data || !credential) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <BackBar />
        <ErrorState title="密钥没加载出来" message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }
  const { providers } = data;
  const provider = providers.find((p) => p.id === credential.provider);

  const onQuery = (text: string): void => {
    setQuery(text);
    const exact = models?.find((m) => m.id === text.trim());
    setPicked(exact ? exact.id : null);
  };

  const updateCredential = (fresh: Credential): void =>
    setData((current) => (current ? { ...current, credential: fresh } : current));

  const probe = async (): Promise<void> => {
    setProbing(true);
    setMessage(null);
    setReport(null);
    try {
      setReport(await api.credentials.probe(credential.id, chosen));
      updateCredential(await api.credentials.get(credential.id));
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
      const route: ModelRoute = await api.routes.put("director", {
        credential_id: credential.id,
        model: chosen,
        params: director?.params ?? {},
      });
      setData((current) => (current ? { ...current, director: route } : current));
      const [first] = describeWindow(route.window);
      setMessage({ tone: "info", text: `已设为导演模型。${first ?? ""}，工作窗口可以在“导演模型”里调。` });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "删除这个密钥？",
      message: "用到它的模型分配会失效，需要重新选择。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.credentials.remove(credential.id);
      overlay.toast(`已删除“${credentialTitle(credential, providers)}”`);
      router.back();
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    }
  };

  const kind = statusKind(credential.status);
  const statusColor = kind === "ok" ? palette.ok : kind === "invalid" ? palette.err : palette.warn;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.bg }}
    >
      <BackBar />
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={{ flex: 1, gap: space.s }}>
            <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>
              {credentialTitle(credential, providers)}
            </Text>
            <View style={styles.statusLine}>
              <Status kind={kind} label={CREDENTIAL_STATUS[credential.status]} />
              {isDirector && director ? (
                <Pill
                  tone="acc"
                  label={
                    <>
                      导演：<Text style={{ fontFamily: font.mono }}>{director.model}</Text>
                    </>
                  }
                />
              ) : null}
            </View>
          </View>
          <IconButton
            icon="write"
            label="编辑备注名和端点"
            size={20}
            diameter={44}
            onPress={() => setEditing(true)}
          />
        </View>
        <View style={styles.grid}>
          {[
            ["服务商", providerName(credential.provider, providers), false],
            ["KEY", `•••• ${credential.key_last4}`, true],
            ["状态", CREDENTIAL_STATUS[credential.status], false],
            ["端点", credential.base_url ?? "官方地址", !!credential.base_url],
          ].map(([key, value, mono]) => (
            <View key={String(key)} style={[styles.cell, { backgroundColor: palette.bg2 }]}>
              <Text style={[styles.cellKey, { color: palette.mut }]}>{key === "KEY" ? "Key" : key}</Text>
              <Text
                numberOfLines={1}
                style={[
                  { fontSize: 15, color: key === "状态" ? statusColor : palette.ink },
                  mono ? { fontFamily: font.mono, fontSize: 14 } : null,
                ]}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>

        <ModelPicker
          models={models}
          listing={listing}
          listError={listError}
          query={query}
          onQuery={onQuery}
          chosen={chosen}
          onPick={setPicked}
          onRefresh={() => void listModels()}
        />
        <View style={styles.actions}>
          <Button
            label="测试这个模型"
            variant="secondary"
            onPress={() => void probe()}
            busy={probing}
            disabled={!chosen}
            style={styles.action}
          >
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "500", color: chosen ? palette.ink : palette.mut }}>
                测试这个模型
              </Text>
              <Text style={{ fontFamily: font.mono, fontSize: 10.5, color: palette.mut }}>约 30 秒</Text>
            </View>
          </Button>
          <Button
            label="设为导演模型"
            onPress={() => void useForDirector()}
            busy={saving}
            disabled={!chosen}
            style={styles.action}
          />
        </View>
        {message ? (
          <Notice
            tone={message.tone}
            message={message.text}
            style={{ marginHorizontal: space.list, marginTop: space.s, borderRadius: 22 }}
          />
        ) : null}
        {report ? <ProbeResults report={report} /> : null}
        {credential.probed_models.length > 0 ? (
          <ProbedModels models={credential.probed_models} onPick={(m) => onQuery(m)} />
        ) : null}

        <View style={styles.bottom}>
          <Button label="更换 Key" variant="secondary" icon="key" onPress={() => setReplacing(true)} />
          <Button label="删除密钥" variant="danger" icon="trash" onPress={() => void remove()} />
          <Text style={{ fontSize: 12.5, color: palette.mut, textAlign: "center" }}>
            用到它的模型分配会失效。
          </Text>
        </View>
      </ScrollView>
      <EditSheet
        visible={editing}
        onClose={() => setEditing(false)}
        credential={credential}
        provider={provider}
        onSaved={updateCredential}
      />
      <ReplaceKeySheet
        visible={replacing}
        onClose={() => setReplacing(false)}
        credential={credential}
        onSaved={(fresh) => {
          updateCredential(fresh);
          setMessage({ tone: "info", text: `Key 已更换，尾号 ${fresh.key_last4}` });
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, minHeight: 60, paddingHorizontal: space.s },
  actions: { flexDirection: "row", gap: space.s, paddingHorizontal: space.list, paddingTop: 10 },
  bottom: { paddingHorizontal: space.list, paddingTop: space.xl, gap: space.s },
  cell: {
    width: "48.9%",
    flexGrow: 1,
    paddingVertical: 14,
    paddingHorizontal: space.l,
    gap: 2,
    borderRadius: 22,
  },
  cellKey: { fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: space.list },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s,
    paddingLeft: space.page,
    paddingRight: space.l,
    paddingTop: space.l,
    paddingBottom: space.l,
  },
  statusLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: "700", letterSpacing: -0.56 },
});
