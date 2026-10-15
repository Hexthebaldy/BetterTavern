/**
 * 添加模型：服务商 → Key（新填，或者复用同一个服务商下已有的 Key）→ 端点 → 获取模型列表并选一个
 * （搜索框兼做手动输入）→ 上下文窗口（只有服务商列表和内置资料都不知道时才出现）→ 备注名、是否设为导演 → 保存。
 * Key、模型、窗口一次存好；之后换导演只是在模型列表里点一下。
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "../../api/client.ts";
import type { ModelInfo, ModelRoute, Provider } from "../../api/types.ts";
import { KeyField, ProviderMark } from "../../components/KeyParts.tsx";
import { Button, CheckMark, Field, Notice, SectionHeader, Segmented } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { space, usePalette } from "../../theme/index.ts";
import { keyChoices, MANUAL_WINDOW_CHOICES, needsManualWindow, providerMark } from "./labels.ts";
import { ModelPicker } from "./ModelPicker.tsx";

/** Key 从哪来：新填的，或者复用哪个模型的 */
type KeySource = { kind: "new" } | { kind: "copy"; routeId: string };

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

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, { backgroundColor: palette.card }]}
    >
      <CheckMark checked={selected} />
      <Text numberOfLines={2} style={{ flex: 1, fontSize: 14.5, lineHeight: 20, color: palette.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AddModelForm({
  providers,
  routes,
  onAdded,
}: {
  providers: Provider[];
  routes: ModelRoute[];
  onAdded: (route: ModelRoute) => void;
}) {
  const { api } = useApp();
  const palette = usePalette();
  const [provider, setProvider] = useState(providers[0]?.id ?? "");
  const [source, setSource] = useState<KeySource>({ kind: "new" });
  const [key, setKey] = useState("");
  const [official, setOfficial] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [windowChoice, setWindowChoice] = useState("unknown");
  const [label, setLabel] = useState("");
  const hasDirector = routes.some((r) => r.is_director);
  const [director, setDirector] = useState(!hasDirector);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = providers.find((p) => p.id === provider);
  const needsUrl = selected?.requires_base_url ?? false;
  const useOfficial = official && !needsUrl;
  const reusable = keyChoices(routes, provider);
  const chosen = picked ?? query.trim();
  const askWindow = needsManualWindow(models, chosen);

  // 换了服务商：Key、端点、列表都从头来；有这个服务商的 Key 时默认复用第一个
  useEffect(() => {
    const first = keyChoices(routes, provider)[0];
    setSource(first ? { kind: "copy", routeId: first.routeId } : { kind: "new" });
    setOfficial(first ? !first.baseUrl : true);
    setBaseUrl(first?.baseUrl ?? "");
    setKey("");
    setModels(null);
    setListError(null);
    setQuery("");
    setPicked(null);
    // routes 变了（刚添加完一个）也只在换服务商时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    setDirector(!hasDirector);
  }, [hasDirector]);

  const endpoint = (): string => (useOfficial ? "" : baseUrl.trim());
  const keyReady = source.kind === "copy" || key.trim() !== "";
  const urlReady = useOfficial || baseUrl.trim() !== "";

  const fetchModels = async (): Promise<void> => {
    setListing(true);
    setListError(null);
    try {
      const list = await api.models.preview(provider, {
        ...(source.kind === "copy" ? { copy_key_from: source.routeId } : { api_key: key.trim() }),
        base_url: endpoint(),
      });
      setModels(list);
      if (list.length === 0) setListError("服务商没有返回模型列表");
    } catch (e) {
      setModels(null);
      setListError(describeError(e));
    } finally {
      setListing(false);
    }
  };

  const onQuery = (text: string): void => {
    setQuery(text);
    const exact = models?.find((m) => m.id === text.trim());
    setPicked(exact ? exact.id : null);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const tokens = askWindow
        ? (MANUAL_WINDOW_CHOICES.find((c) => c.value === windowChoice)?.tokens ?? null)
        : null;
      const created = await api.models.create({
        provider,
        model: chosen,
        label: label.trim(),
        ...(source.kind === "copy" ? { copy_key_from: source.routeId } : { api_key: key.trim() }),
        base_url: endpoint(),
        manual_window: tokens,
        director,
      });
      setKey("");
      setLabel("");
      setQuery("");
      setPicked(null);
      setWindowChoice("unknown");
      onAdded(created);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.s }}>
      <View style={[styles.form, { backgroundColor: palette.bg2 }]}>
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

        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: palette.ink2 }]}>API Key</Text>
          {reusable.length > 0 ? (
            <View accessibilityRole="radiogroup" accessibilityLabel="API Key" style={{ gap: 6 }}>
              {reusable.map((c) => (
                <Choice
                  key={c.routeId}
                  label={`用已有的 Key（尾号 ${c.last4}，${c.titles.join("、")} 在用）`}
                  selected={source.kind === "copy" && source.routeId === c.routeId}
                  onPress={() => {
                    setSource({ kind: "copy", routeId: c.routeId });
                    setOfficial(!c.baseUrl);
                    setBaseUrl(c.baseUrl ?? "");
                    setModels(null);
                  }}
                />
              ))}
              <Choice
                label="填一个新的 Key"
                selected={source.kind === "new"}
                onPress={() => {
                  setSource({ kind: "new" });
                  setModels(null);
                }}
              />
            </View>
          ) : null}
          {source.kind === "new" ? (
            <KeyField
              label="API Key"
              hideLabel
              onGrey
              value={key}
              onChangeText={(text) => {
                setKey(text);
                setModels(null);
              }}
              placeholder="sk-…"
              hint="只发送这一次，之后只显示后四位。"
              hintIcon="lock"
            />
          ) : null}
        </View>

        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: palette.ink2 }]}>端点地址</Text>
          {needsUrl ? null : (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: official }}
              onPress={() => setOfficial((v) => !v)}
              style={[styles.choice, { backgroundColor: palette.card }]}
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
              onChangeText={(text) => {
                setBaseUrl(text);
                setModels(null);
              }}
              mono
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={selected?.default_base_url ?? "https://example.com/v1"}
            />
          )}
          {needsUrl ? (
            <Text style={[styles.note, { color: palette.mut }]}>
              OpenAI 兼容接口的地址，通常以 /v1 结尾。
            </Text>
          ) : null}
        </View>

        <Button
          label={models ? "重新获取模型列表" : "获取模型列表"}
          variant="secondary"
          icon="retry"
          onPress={() => void fetchModels()}
          busy={listing}
          disabled={!keyReady || !urlReady}
        />
      </View>

      <ModelPicker
        models={models}
        listing={listing}
        listError={listError}
        query={query}
        onQuery={onQuery}
        chosen={chosen}
        onPick={setPicked}
        onRefresh={() => void fetchModels()}
      />

      {askWindow ? (
        <View>
          <SectionHeader title="上下文窗口" />
          <View style={[styles.form, { backgroundColor: palette.bg2, gap: space.m }]}>
            <Text style={{ fontSize: 14, lineHeight: 22, color: palette.ink2 }}>
              {models
                ? "服务商的列表里没有这个模型能读多少。知道的话选一下；不知道就先按 32K 估计，之后服务商要是报“超长”会自动纠正。"
                : "还没获取模型列表，保存时会再查一次。查不到的话按这里选的算；不知道就先按 32K 估计。"}
            </Text>
            <Segmented
              value={windowChoice}
              options={MANUAL_WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
              onChange={setWindowChoice}
              mono
            />
          </View>
        </View>
      ) : null}

      <View style={[styles.form, { backgroundColor: palette.bg2, marginTop: space.s }]}>
        {error ? <Notice message={error} /> : null}
        <Field
          label="备注名"
          optional
          onGrey
          value={label}
          onChangeText={setLabel}
          maxLength={60}
          placeholder={chosen || "不填就显示模型名"}
        />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: director }}
          onPress={() => setDirector((v) => !v)}
          style={[styles.choice, { backgroundColor: palette.card }]}
        >
          <CheckMark checked={director} />
          <Text style={{ flex: 1, fontSize: 15, color: palette.ink }}>
            {hasDirector ? "设为导演（替换现在的导演）" : "设为导演"}
          </Text>
        </Pressable>
        <Button
          label="保存模型"
          trailingIcon="arrowRight"
          between
          onPress={() => void save()}
          busy={busy}
          disabled={!chosen || !keyReady || !urlReady}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 52,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    borderRadius: 16,
  },
  note: { fontSize: 12.5, lineHeight: 18, paddingLeft: space.xs },
});
