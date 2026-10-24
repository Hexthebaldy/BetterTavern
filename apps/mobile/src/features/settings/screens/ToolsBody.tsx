/**
 * 外部服务（同网页端 pages/settings/ToolsBody.tsx）：工作台的 agent 查资料、读网页、生成封面时用的服务，分三种：
 * 网页搜索、读网页（默认服务器自己读，可选 Jina）、生成封面（按接口协议接）。
 * 每一种可以配几个，其中一个是默认；可以测试、设为默认、换 Key、删除。添加用底部面板，加好就测一次。
 * 路由页面是 app/settings/tools.tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ToolKind, ToolProvider, ToolRoute } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";

import { KeyField } from "../../../components/KeyParts.tsx";
import {
  Button,
  Chip,
  ErrorState,
  Field,
  Loading,
  Notice,
  Pill,
  SectionHeader,
  Sheet,
  Status,
  useColumnStyle,
  useOverlay,
} from "../../../components/ui.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { useApp } from "../../../state/AppProvider.tsx";
import { comicRadius, comicStroke, font, space, useComic } from "../../../theme/index.ts";
import { SettingsBack } from "../nav.tsx";

const KINDS: ToolKind[] = ["search", "fetch", "image"];

function providerLabel(id: string): string {
  return i18n.t(`tools.providers.${id as "tavily"}`, { defaultValue: id });
}

function AddSheet({
  kind,
  providers,
  onClose,
  onAdded,
}: {
  kind: ToolKind | null;
  providers: ToolProvider[];
  onClose: () => void;
  onAdded: (route: ToolRoute) => void;
}) {
  const { t } = useTranslation();
  const { api } = useApp();
  const options = kind ? providers.filter((p) => p.kinds.includes(kind)) : [];
  const [provider, setProvider] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = options.find((p) => p.id === provider) ?? options[0];
  const ready =
    !!selected &&
    (!selected.needs_key || key.trim() !== "") &&
    (!selected.needs_base_url || baseUrl.trim() !== "") &&
    (!selected.needs_model || model.trim() !== "");

  const close = (): void => {
    setProvider(null);
    setKey("");
    setBaseUrl("");
    setModel("");
    setLabel("");
    setError(null);
    setBusy(false);
    onClose();
  };

  const save = async (): Promise<void> => {
    if (!selected || !kind) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.tools.create({
        kind,
        provider: selected.id,
        label: label.trim() || undefined,
        api_key: key.trim() || null,
        base_url: baseUrl.trim() || null,
        model: model.trim() || null,
      });
      onAdded(created);
      close();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const kindName = kind ? t(`tools.kinds.${kind}`) : "";
  return (
    <Sheet visible={kind !== null} onClose={close} title={t("tools.addTitle", { kind: kindName })}>
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.chips}>
          {options.map((p) => (
            <Chip
              key={p.id}
              small
              label={providerLabel(p.id)}
              selected={p.id === selected?.id}
              onPress={() => {
                setProvider(p.id);
                setError(null);
              }}
            />
          ))}
        </View>
        {selected ? (
          <>
            <KeyField
              label={selected.needs_key ? t("tools.apiKey") : t("tools.apiKeyOptional")}
              value={key}
              onChangeText={setKey}
            />
            <Field
              label={selected.needs_base_url ? t("tools.baseUrl") : t("tools.baseUrlOptional")}
              value={baseUrl}
              placeholder="https://"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setBaseUrl}
            />
            {selected.needs_model ? (
              <Field
                label={t("tools.model")}
                value={model}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setModel}
              />
            ) : null}
            <Field label={t("tools.label")} optional value={label} maxLength={60} onChangeText={setLabel} />
          </>
        ) : null}
        {error ? <Notice message={error} /> : null}
        <Button label={t("tools.add")} busy={busy} disabled={!ready} onPress={() => void save()} />
      </ScrollView>
    </Sheet>
  );
}

function RouteCard({ route, onChanged }: { route: ToolRoute; onChanged: () => void }) {
  const c = useComic();
  const { t } = useTranslation();
  const { api } = useApp();
  const overlay = useOverlay();
  const [testing, setTesting] = useState(false);
  const name = route.label || providerLabel(route.provider);
  const detail = route.probe.detail ?? "";

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      onChanged();
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    await run(() => api.tools.test(route.id));
    setTesting(false);
  };

  const replaceKey = async (): Promise<void> => {
    const key = await overlay.prompt({ title: t("tools.replaceKey"), label: t("tools.apiKey") });
    if (key?.trim()) await run(() => api.tools.update(route.id, { api_key: key.trim() }));
  };

  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("tools.deleteTitle", { name }),
      message: t("tools.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) await run(() => api.tools.remove(route.id));
  };

  const meta = [
    route.label ? providerLabel(route.provider) : "",
    route.model ?? "",
    route.base_url ?? "",
    route.has_key ? t("tools.keyTail", { last4: route.key_last4 }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={[styles.card, { backgroundColor: c.paper, borderColor: c.ink }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.s }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 16, fontWeight: "900", color: c.ink }}>{name}</Text>
          {meta ? <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.mut }}>{meta}</Text> : null}
        </View>
        {route.is_default ? <Pill label={t("tools.default")} tone="accSolid" /> : null}
      </View>
      <View style={{ flexDirection: "row" }}>
        <Status
          kind={route.status === "ok" ? "ok" : route.status === "invalid" ? "invalid" : "untested"}
          label={
            route.status === "ok"
              ? t("tools.testOk", { detail })
              : route.status === "invalid"
                ? t("tools.testFailed", { detail })
                : t("tools.untested")
          }
        />
      </View>
      <View style={styles.chips}>
        <Chip small label={testing ? t("tools.testing") : t("tools.test")} onPress={() => void test()} />
        {route.is_default ? null : (
          <Chip small label={t("tools.makeDefault")} onPress={() => void run(() => api.tools.update(route.id, { default: true }))} />
        )}
        {route.has_key ? <Chip small label={t("tools.replaceKey")} onPress={() => void replaceKey()} /> : null}
        <Chip small label={t("common.delete")} onPress={() => void remove()} />
      </View>
    </View>
  );
}

export function ToolsBody() {
  const { api } = useApp();
  const c = useComic();
  const column = useColumnStyle();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const [adding, setAdding] = useState<ToolKind | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const [providers, routes] = await Promise.all([api.tools.providers(), api.tools.list()]);
    return { providers, routes };
  }, [api]);

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
        <SettingsBack />
        <ErrorState title={t("tools.loadFailed")} message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.page }}
    >
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.big, { color: c.ink }]}>
            {t("tools.title")}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, color: c.mut }}>{t("tools.intro")}</Text>
        </View>
        {KINDS.map((kind) => {
          const list = data.routes.filter((r) => r.kind === kind);
          return (
            <View key={kind} style={{ gap: space.s }}>
              <SectionHeader
                title={t(`tools.kinds.${kind}`)}
                meta={<Chip small icon="plus" label={t("tools.add")} onPress={() => setAdding(kind)} />}
              />
              <Text style={[styles.note, { color: c.mut }]}>{t(`tools.kindNotes.${kind}`)}</Text>
              {list.length ? (
                list.map((route) => <RouteCard key={route.id} route={route} onChanged={() => void reload()} />)
              ) : (
                <Text style={[styles.note, { color: c.mut }]}>{t("tools.none")}</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
      <AddSheet
        kind={adding}
        providers={data.providers}
        onClose={() => setAdding(null)}
        onAdded={(route) => {
          overlay.toast(t("tools.saved"));
          // 加好就测一次，马上知道能不能用
          void api.tools
            .test(route.id)
            .catch(() => undefined)
            .finally(() => void reload());
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.page, paddingTop: space.s, paddingBottom: space.s, gap: space.s },
  big: { fontSize: 28, lineHeight: 34, fontWeight: "900" },
  note: { paddingHorizontal: space.page, fontSize: 13, lineHeight: 20 },
  card: {
    marginHorizontal: 20,
    padding: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    gap: 10,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  sheet: { paddingHorizontal: 18, paddingBottom: space.xl, gap: space.m },
});
