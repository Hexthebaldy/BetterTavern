/**
 * 添加模型（W13，同 App 的 AddModelForm）：服务商 → 新的 Key → 端点 → 模型列表自动获取，选一个
 * （搜索框兼做手动输入）→ 上下文窗口（只有服务商列表和内置资料都不知道时才出现）→ 备注名、是否设为导演 → 保存。
 * 右栏够宽时分两栏：左边服务商、Key、端点；右边选择模型、备注名；下面一整行是“设为导演”和“保存模型”。
 */

import { useEffect, useRef, useState } from "react";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelInfo, ModelRoute, Provider } from "@bettertavern/core/api/types";
import { MANUAL_WINDOW_CHOICES, needsManualWindow } from "@bettertavern/core/settings/labels";

import { Button, Checkbox, cx, Field, Notice } from "../../components/controls.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { KeyField, ProviderMark, SectionHeader } from "./parts.tsx";
import { Segmented } from "./Segmented.tsx";
import styles from "./settings.module.css";

function ProviderTile({
  provider,
  selected,
  onSelect,
}: {
  provider: Provider;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cx(styles.providerTile, selected && styles.providerOn)}
      onClick={onSelect}
    >
      <ProviderMark provider={provider.id} size={36} tone={selected ? "acc" : "grey"} />
      {provider.requires_base_url ? "自定义兼容端点" : provider.display_name}
    </button>
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
  const [provider, setProvider] = useState(providers[0]?.id ?? "");
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

  useEffect(() => setDirector(!hasDirector), [hasDirector]);

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

  // Key 和端点填好、停手一会儿就自动获取模型列表；失败了不会反复重试，要手动点“重新获取”
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
    <div className={styles.addForm}>
      <div className={cx(styles.formCard, styles.addLeft)}>
        <div className={styles.formGroup}>
          <span className={styles.formLabel}>服务商</span>
          <div className={styles.providerTiles} role="radiogroup" aria-label="服务商">
            {providers.map((p) => (
              <ProviderTile
                key={p.id}
                provider={p}
                selected={p.id === provider}
                onSelect={() => setProvider(p.id)}
              />
            ))}
          </div>
        </div>
        <KeyField
          label="API Key"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setModels(null);
          }}
          placeholder="sk-…"
          hint="只发送这一次，之后只显示后四位。"
        />
        <div className={styles.formGroup}>
          <span className={styles.formLabel}>端点地址</span>
          {needsUrl ? null : (
            <div className={styles.choice}>
              <Checkbox label="使用官方地址" checked={official} onToggle={() => setOfficial((v) => !v)} />
            </div>
          )}
          {useOfficial ? null : (
            <Field
              label="端点地址"
              className={styles.hiddenLabel}
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setModels(null);
              }}
              type="url"
              spellCheck={false}
              placeholder={selected?.default_base_url ?? "https://example.com/v1"}
            />
          )}
          {needsUrl ? <p className={styles.note}>OpenAI 兼容接口的地址，通常以 /v1 结尾。</p> : null}
        </div>
        <Button
          label={models ? "重新获取模型列表" : "获取模型列表"}
          variant="secondary"
          icon="retry"
          busy={listing}
          disabled={!keyReady || !urlReady}
          onClick={() => void fetchModels()}
        />
      </div>

      <div className={styles.addRight}>
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
          <div>
            <SectionHeader title="上下文窗口" />
            <div className={styles.formCard}>
              <p className={styles.lead}>
                {models
                  ? "服务商的列表里没有这个模型能读多少。知道的话选一下；不知道就先按 32K 估计，之后服务商要是报“超长”会自动纠正。"
                  : "还没获取模型列表，保存时会再查一次。查不到的话按这里选的算；不知道就先按 32K 估计。"}
              </p>
              <Segmented
                label="上下文窗口"
                value={windowChoice}
                options={MANUAL_WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
                onChange={setWindowChoice}
                mono
              />
            </div>
          </div>
        ) : null}
        <div className={styles.formCard}>
          <Field
            label="备注名"
            optional
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            placeholder={chosen || "不填就显示模型名"}
          />
        </div>
      </div>

      <div className={cx(styles.formCard, styles.addBottom)}>
        {error ? <Notice message={error} /> : null}
        <div className={styles.saveRow}>
          <div className={styles.choice}>
            <Checkbox
              label={hasDirector ? "设为导演（替换现在的导演）" : "设为导演"}
              checked={director}
              onToggle={() => setDirector((v) => !v)}
            />
          </div>
          <Button
            label="保存模型"
            size="lg"
            between
            trailingIcon="arrowRight"
            busy={busy}
            disabled={!chosen || !keyReady || !urlReady}
            className={styles.saveButton}
            onClick={() => void save()}
          />
        </div>
      </div>
    </div>
  );
}
