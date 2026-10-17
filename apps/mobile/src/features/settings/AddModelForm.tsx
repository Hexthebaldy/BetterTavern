/**
 * 添加模型：服务商 → 新的 Key → 端点 → 模型列表自动获取，选一个
 * （搜索框兼做手动输入）→ 上下文窗口（只有服务商列表和内置资料都不知道时才出现）→ 备注名、是否设为导演 → 保存。
 * Key、模型、窗口一次存好；之后换导演只是在模型列表里点一下。
 */

import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelInfo, ModelRoute, Provider } from "@bettertavern/core/api/types";
import { MANUAL_WINDOW_CHOICES, needsManualWindow } from "@bettertavern/core/settings/labels";

import { KeyField, ProviderMark } from "../../components/KeyParts.tsx";
import { Button, CheckMark, Field, Notice, SectionHeader, Segmented } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { space, usePalette } from "../../theme/index.ts";
import { ModelPicker } from "./ModelPicker.tsx";

function ProviderTile({
  provider,
  selected,
  onPress,
  width,
}: {
  provider: Provider;
  selected: boolean;
  onPress: () => void;
  /** 一行三块，宽度由外面量出来算好 */
  width: number | undefined;
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
        width ? { width } : { flex: 1 },
        selected
          ? { backgroundColor: palette.accBg, boxShadow: `inset 0 0 0 2px ${palette.acc}` }
          : { backgroundColor: palette.card },
        { transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      <ProviderMark provider={provider.id} size={36} tone={selected ? "acc" : "grey"} />
      <Text style={{ fontSize: 13.5, lineHeight: 18, color: palette.ink }}>
        {provider.requires_base_url ? "自定义兼容端点" : provider.display_name}
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
  const [tilesWidth, setTilesWidth] = useState<number | null>(null);
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
  const chosen = picked ?? query.trim();
  const askWindow = needsManualWindow(models, chosen);

  // 换了服务商：Key、端点、列表都从头来
  useEffect(() => {
    setOfficial(true);
    setBaseUrl("");
    setKey("");
    setModels(null);
    setListError(null);
    setQuery("");
    setPicked(null);
  }, [provider]);

  useEffect(() => {
    setDirector(!hasDirector);
  }, [hasDirector]);

  const endpoint = (): string => (useOfficial ? "" : baseUrl.trim());
  const keyReady = key.trim() !== "";
  const urlReady = useOfficial || baseUrl.trim() !== "";

  // 每次获取编一个号；Key、端点改了以后，还没回来的旧请求作废，免得旧 Key 的列表盖掉新的
  const requestSeq = useRef(0);
  const fetchModels = async (): Promise<void> => {
    const seq = ++requestSeq.current;
    setListing(true);
    setListError(null);
    try {
      const list = await api.models.preview(provider, { api_key: key.trim(), base_url: endpoint() });
      if (seq !== requestSeq.current) return;
      setModels(list);
      if (list.length === 0) setListError("服务商没有返回模型列表");
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setModels(null);
      setListError(describeError(e));
    } finally {
      if (seq === requestSeq.current) setListing(false);
    }
  };

  // Key 和端点填好、停手一会儿就自动获取模型列表。
  // 只在输入变了的时候获取：失败了不会反复重试，要手动点“重新获取”
  const inputs = keyReady && urlReady ? JSON.stringify([provider, key.trim(), endpoint()]) : null;
  useEffect(() => {
    requestSeq.current += 1;
    setListing(false);
    setListError(null);
    if (inputs === null) return;
    const timer = setTimeout(() => void fetchModels(), 800);
    return () => clearTimeout(timer);
    // fetchModels 读的就是 inputs 里的这些值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs]);

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
        api_key: key.trim(),
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
          <View
            style={styles.tiles}
            accessibilityRole="radiogroup"
            accessibilityLabel="服务商"
            onLayout={(e) => setTilesWidth(e.nativeEvent.layout.width)}
          >
            {providers.map((p) => (
              <ProviderTile
                key={p.id}
                provider={p}
                selected={p.id === provider}
                onPress={() => setProvider(p.id)}
                width={tilesWidth ? (tilesWidth - TILE_GAP * 2) / 3 : undefined}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: palette.ink2 }]}>API Key</Text>
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

/** 服务商图块之间的间距；一行三块 */
const TILE_GAP = 6;

const styles = StyleSheet.create({
  form: {
    marginHorizontal: space.list,
    paddingVertical: space.l,
    paddingHorizontal: space.m,
    borderRadius: 30,
    gap: 22,
  },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500", paddingLeft: space.xs },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP },
  tile: {
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
