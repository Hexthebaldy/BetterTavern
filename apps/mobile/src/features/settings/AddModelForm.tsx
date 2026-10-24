/**
 * 添加模型：服务商 → 新的 Key → 端点 → 模型列表自动获取，选一个
 * （搜索框兼做手动输入）→ 上下文窗口（只有服务商列表和内置资料都不知道时才出现）→ 备注名、是否设为导演 → 保存。
 * Key、模型、窗口一次存好；之后换导演只是在模型列表里点一下。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelInfo, ModelRoute, Provider } from "@bettertavern/core/api/types";
import { manualWindowChoices, needsManualWindow } from "@bettertavern/core/settings/labels";

import { KeyField, ProviderMark } from "../../components/KeyParts.tsx";
import { Button, CheckMark, Field, Notice, SectionHeader, Segmented } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { comicDepth, comicRadius, comicStroke, hardShadow, space, useComic } from "../../theme/index.ts";
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
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={provider.requires_base_url ? t("models.customProvider") : provider.display_name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        width ? { width } : { flex: 1 },
        selected
          ? { borderColor: c.acc, backgroundColor: c.paper, boxShadow: hardShadow(c.acc, comicDepth.focus) }
          : { borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper },
      ]}
    >
      <ProviderMark provider={provider.id} size={36} tone={selected ? "acc" : "card"} />
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={{ fontSize: 14, lineHeight: 18, fontWeight: "700", textAlign: "center", color: c.ink }}
      >
        {provider.requires_base_url ? t("models.customProvider") : provider.display_name}
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
  const c = useComic();
  const { t } = useTranslation();
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
      if (list.length === 0) setListError(t("models.emptyList"));
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
        ? (manualWindowChoices().find((c) => c.value === windowChoice)?.tokens ?? null)
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
      <View style={styles.form}>
        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: c.ink }]}>{t("models.provider")}</Text>
          <View
            style={styles.tiles}
            accessibilityRole="radiogroup"
            accessibilityLabel={t("models.provider")}
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
          <Text style={[styles.label, { color: c.ink }]}>{t("models.apiKey")}</Text>
          <KeyField
            label={t("models.apiKey")}
            hideLabel
            value={key}
            onChangeText={(text) => {
              setKey(text);
              setModels(null);
            }}
            placeholder="sk-…"
            hint={t("models.keyHint")}
            hintIcon="lock"
          />
        </View>

        <View style={{ gap: space.s }}>
          <Text style={[styles.label, { color: c.ink }]}>{t("models.endpoint")}</Text>
          {needsUrl ? null : (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: official }}
              onPress={() => setOfficial((v) => !v)}
              style={({ pressed }) => [styles.choice, { borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper }]}
            >
              <CheckMark checked={official} />
              <Text style={{ fontSize: 15, color: c.ink }}>{t("models.official")}</Text>
            </Pressable>
          )}
          {useOfficial ? null : (
            <Field
              label={t("models.endpoint")}
              hideLabel
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
            <Text style={[styles.note, { color: c.mut }]}>{t("models.endpointNote")}</Text>
          ) : null}
        </View>

        <Button
          label={models ? t("models.refetchList") : t("models.fetchList")}
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
          <SectionHeader title={t("models.contextWindow")} />
          <View style={[styles.form, styles.framed, { borderColor: c.ink, backgroundColor: c.paper, gap: space.m }]}>
            <Text style={{ fontSize: 14, lineHeight: 22, color: c.ink2 }}>
              {models ? t("models.windowAskListed") : t("models.windowAskUnlisted")}
            </Text>
            <Segmented
              value={windowChoice}
              options={manualWindowChoices().map((c) => ({ value: c.value, label: c.label }))}
              onChange={setWindowChoice}
              mono
            />
          </View>
        </View>
      ) : null}

      <View style={[styles.form, { marginTop: space.s }]}>
        {error ? <Notice message={error} /> : null}
        <Field
          label={t("models.label")}
          optional
          value={label}
          onChangeText={setLabel}
          maxLength={60}
          placeholder={chosen || t("models.labelPlaceholder")}
        />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: director }}
          onPress={() => setDirector((v) => !v)}
          style={({ pressed }) => [styles.choice, { borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper }]}
        >
          <CheckMark checked={director} />
          <Text style={{ flex: 1, fontSize: 15, color: c.ink }}>
            {hasDirector ? t("models.makeDirectorReplace") : t("models.makeDirector")}
          </Text>
        </Pressable>
        <Button
          label={t("models.saveModel")}
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
const TILE_GAP = 10;

const styles = StyleSheet.create({
  /** 一段表单：直接放在页面上，左右 20 */
  form: { marginHorizontal: 20, paddingVertical: space.s, gap: 22 },
  /** 问上下文长度的那一块是墨线格子 */
  framed: { padding: 14, borderWidth: comicStroke.frame, borderRadius: comicRadius.frame },
  label: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, paddingBottom: comicDepth.focus },
  tile: {
    minHeight: 88,
    paddingVertical: 12,
    paddingHorizontal: space.s,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 56,
    paddingVertical: space.s,
    paddingHorizontal: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  note: { fontSize: 12.5, lineHeight: 18 },
});
