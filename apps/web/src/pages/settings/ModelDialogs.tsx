/** 模型详情页的对话框（同 App 的 ModelSheets）：编辑（备注名、模型名、端点）、更换 Key、填写上下文窗口 */

import { useRef, useState, type ReactNode, type RefObject } from "react";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoutePatch } from "@bettertavern/core/api/endpoints";
import type { ModelRoute, Provider } from "@bettertavern/core/api/types";
import { MANUAL_WINDOW_CHOICES, manualWindowChoice } from "@bettertavern/core/settings/labels";

import { Button, Checkbox, Field, Notice } from "../../components/controls.tsx";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { KeyField } from "./parts.tsx";
import { Segmented } from "./Segmented.tsx";
import styles from "./settings.module.css";

function Frame({
  title,
  onClose,
  first,
  children,
}: {
  title: string;
  onClose: () => void;
  first: RefObject<HTMLInputElement | null>;
  children: ReactNode;
}) {
  return (
    <Dialog label={title} onClose={onClose} initialFocus={first}>
      <h2 className={styles.dialogTitle}>{title}</h2>
      <div className={styles.dialogBody}>{children}</div>
    </Dialog>
  );
}

export function EditDialog({
  route,
  provider,
  onClose,
  onSaved,
}: {
  route: ModelRoute;
  provider: Provider | undefined;
  onClose: () => void;
  onSaved: (route: ModelRoute) => void;
}) {
  const { api } = useApp();
  const first = useRef<HTMLInputElement>(null);
  const needsUrl = provider?.requires_base_url ?? false;
  const [label, setLabel] = useState(route.label);
  const [model, setModel] = useState(route.model);
  const [official, setOfficial] = useState(!route.base_url);
  const [baseUrl, setBaseUrl] = useState(route.base_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setBusy(false);
    }
  };

  return (
    <Frame title="编辑模型" onClose={onClose} first={first}>
      {error ? <Notice message={error} /> : null}
      <Field
        ref={first}
        label="备注名"
        optional
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={60}
        placeholder={route.model}
      />
      <Field
        label="模型名"
        className={styles.monoField}
        value={model}
        onChange={(e) => setModel(e.target.value)}
        spellCheck={false}
        maxLength={200}
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
            className={`${styles.hiddenLabel} ${styles.monoField}`}
            type="url"
            spellCheck={false}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={provider?.default_base_url ?? "https://example.com/v1"}
          />
        )}
      </div>
      {urlChanged || modelChanged ? (
        <p className={styles.warnNote}>
          换了{modelChanged ? "模型名" : "端点"}，之前的测试结果和上下文窗口会重新确定。
        </p>
      ) : null}
      <Button
        label="保存"
        size="lg"
        busy={busy}
        disabled={!model.trim() || (!useOfficial && !baseUrl.trim())}
        onClick={() => void save()}
      />
    </Frame>
  );
}

export function ReplaceKeyDialog({
  route,
  onClose,
  onSaved,
}: {
  route: ModelRoute;
  onClose: () => void;
  onSaved: (route: ModelRoute) => void;
}) {
  const { api } = useApp();
  const first = useRef<HTMLInputElement>(null);
  const shared = route.shares_key_with.length;
  const [key, setKey] = useState("");
  const [together, setTogether] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.models.update(route.id, { api_key: key.trim(), apply_to_same_key: shared > 0 && together }),
      );
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };
  return (
    <Frame title="更换 Key" onClose={onClose} first={first}>
      {error ? <Notice message={error} /> : null}
      <KeyField
        ref={first}
        label="新的 API Key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="sk-…"
        hint={`现在的尾号 ${route.key_last4}。换了之后测试结果会清空。`}
      />
      {shared > 0 ? (
        <div className={styles.choice}>
          <Checkbox
            label={`另外 ${shared} 个模型也用这个 Key，一起换`}
            checked={together}
            onToggle={() => setTogether((v) => !v)}
          />
        </div>
      ) : null}
      <Button label="更换" size="lg" busy={busy} disabled={!key.trim()} onClick={() => void save()} />
    </Frame>
  );
}

export function WindowDialog({
  route,
  onClose,
  onSaved,
}: {
  route: ModelRoute;
  onClose: () => void;
  onSaved: (route: ModelRoute) => void;
}) {
  const { api } = useApp();
  const first = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState(manualWindowChoice(route.manual_window));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const tokens = MANUAL_WINDOW_CHOICES.find((c) => c.value === choice)?.tokens ?? null;
      onSaved(await api.models.update(route.id, { manual_window: tokens }));
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };
  return (
    <Frame title="上下文窗口" onClose={onClose} first={first}>
      {error ? <Notice message={error} /> : null}
      <p className={styles.lead}>
        这个模型一次最多能读多少 token。服务商的说明页一般会写；不知道就选“不知道”，先按 32K 估计。
      </p>
      <Segmented
        label="上下文窗口"
        value={choice}
        options={MANUAL_WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
        onChange={setChoice}
        mono
      />
      <Button label="保存" size="lg" busy={busy} onClick={() => void save()} />
    </Frame>
  );
}
