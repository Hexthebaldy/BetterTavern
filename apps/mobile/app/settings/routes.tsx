/**
 * 导演模型：写故事用的模型、工作窗口上限（服务端按模型的上下文长度校验）和思考开关。
 * 换模型在“密钥与端点”里选。
 */

import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";

import { describeError } from "../../src/api/client.ts";
import type { ModelRoute } from "../../src/api/types.ts";
import {
  Body,
  Button,
  Caption,
  GroupLabel,
  Heading,
  ListRow,
  Loading,
  Notice,
  Page,
  Segmented,
} from "../../src/components/ui.tsx";
import { credentialTitle, describeWindow } from "../../src/features/settings/labels.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";

type WindowChoice = "32000" | "64000" | "default" | "256000";

const WINDOWS: { value: WindowChoice; label: string }[] = [
  { value: "32000", label: "32K" },
  { value: "64000", label: "64K" },
  { value: "default", label: "128K" },
  { value: "256000", label: "256K" },
];

function windowChoice(route: ModelRoute): WindowChoice {
  const w = route.params.working_window;
  if (w === 32000 || w === 64000 || w === 256000) return String(w) as WindowChoice;
  return "default";
}

export default function RoutesScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const { data, error, loading, refreshing, reload, setData } = useAsync(async () => {
    const [routes, credentials, providers] = await Promise.all([
      api.routes.list(),
      api.credentials.list(),
      api.credentials.providers(),
    ]);
    return { director: routes.find((r) => r.task === "director") ?? null, credentials, providers };
  }, [api]);
  const [windowValue, setWindowValue] = useState<WindowChoice>("default");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const director = data?.director ?? null;
  useEffect(() => {
    if (!director) return;
    setWindowValue(windowChoice(director));
    setThinking(director.params.thinking === true);
  }, [director]);

  if (loading && !data) return <Loading />;

  const save = async (): Promise<void> => {
    if (!director) return;
    setSaving(true);
    setMessage(null);
    try {
      const params = { ...director.params, thinking } as ModelRoute["params"];
      if (windowValue === "default") delete params.working_window;
      else params.working_window = Number(windowValue);
      const route = await api.routes.put("director", {
        credential_id: director.credential_id,
        model: director.model,
        params,
        caps_override: director.caps_override,
        fallback_route_id: director.fallback_route_id,
      });
      setData((current) => (current ? { ...current, director: route } : current));
      setMessage({ tone: "info", text: "已保存" });
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  const credentials = data?.credentials ?? [];
  const dirty =
    director !== null &&
    (windowChoice(director) !== windowValue || (director.params.thinking === true) !== thinking);

  return (
    <Page refreshing={refreshing} onRefresh={() => void reload()}>
      {error ? (
        <Notice message={describeError(error)} actionLabel="重试" onAction={() => void reload()} />
      ) : null}
      {director ? (
        <>
          <Heading>{director.model}</Heading>
          <Caption style={{ marginTop: space.xs }}>{director.credential_label || director.provider}</Caption>
          <View style={styles.window}>
            {describeWindow(director.window).map((line) => (
              <Body key={line} style={{ color: palette.muted }}>
                {line}
              </Body>
            ))}
          </View>

          <GroupLabel>设置</GroupLabel>
          {message ? <Notice tone={message.tone} message={message.text} /> : null}
          <Segmented label="工作窗口上限" value={windowValue} options={WINDOWS} onChange={setWindowValue} />
          <Caption style={{ marginTop: -space.s, marginBottom: space.l }}>
            每轮发给模型的上下文不超过这个长度，超过 80%
            时压缩较早的剧情。超过模型的上下文长度时按模型的上限算。
          </Caption>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Body>深度思考</Body>
              <Caption>模型支持时先思考再写，更慢</Caption>
            </View>
            <Switch
              value={thinking}
              onValueChange={setThinking}
              trackColor={{ true: palette.accent, false: palette.rule }}
              accessibilityLabel="深度思考"
            />
          </View>
          <Button
            label="保存"
            onPress={() => void save()}
            busy={saving}
            disabled={!dirty}
            style={{ marginTop: space.l }}
          />
          <Button
            label="换一个模型"
            variant="secondary"
            onPress={() => router.push("/settings/credentials")}
            style={{ marginTop: space.m }}
          />
        </>
      ) : data ? (
        <>
          <Body style={{ marginBottom: space.l }}>
            还没有设置导演模型。导演负责写每一段叙述和两个选项，选一个你有 Key 的模型。
          </Body>
          {credentials.length > 0 ? (
            <>
              <GroupLabel>从这些密钥里选</GroupLabel>
              {credentials.map((c) => (
                <ListRow
                  key={c.id}
                  title={credentialTitle(c, data.providers)}
                  subtitle={`尾号 ${c.key_last4}`}
                  onPress={() => router.push({ pathname: "/settings/credential/[id]", params: { id: c.id } })}
                />
              ))}
            </>
          ) : (
            <Button label="添加密钥" onPress={() => router.push("/settings/credentials")} />
          )}
        </>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  window: { marginTop: space.m, gap: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.m },
});
