/** 模型详情页的对话框（同 App 的 ModelSheets）：编辑（备注名、模型名、端点）、更换 Key、填写上下文窗口 */

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoutePatch } from "@bettertavern/core/api/endpoints";
import type { ModelRoute, Provider } from "@bettertavern/core/api/types";
import { manualWindowChoice, manualWindowChoices } from "@bettertavern/core/settings/labels";

import { Button, Checkbox, Field, Notice, Segmented } from "../../components/controls.tsx";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { KeyField } from "./parts.tsx";
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
  const { t } = useTranslation();
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
    <Frame title={t("models.editTitle")} onClose={onClose} first={first}>
      {error ? <Notice message={error} /> : null}
      <Field
        ref={first}
        label={t("models.label")}
        optional
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={60}
        placeholder={route.model}
      />
      <Field
        label={t("models.modelName")}
        className={styles.monoField}
        value={model}
        onChange={(e) => setModel(e.target.value)}
        spellCheck={false}
        maxLength={200}
      />
      <div className={styles.formGroup}>
        <span className={styles.formLabel}>{t("models.endpoint")}</span>
        {needsUrl ? null : (
          <div className={styles.choice}>
            <Checkbox
              label={t("models.official")}
              checked={official}
              onToggle={() => setOfficial((v) => !v)}
            />
          </div>
        )}
        {useOfficial ? null : (
          <Field
            label={t("models.endpoint")}
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
          {modelChanged ? t("models.changedModel") : t("models.changedEndpoint")}
        </p>
      ) : null}
      <Button
        label={t("common.save")}
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
  const { t } = useTranslation();
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
    <Frame title={t("models.replaceKey")} onClose={onClose} first={first}>
      {error ? <Notice message={error} /> : null}
      <KeyField
        ref={first}
        label={t("models.newKey")}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="sk-…"
        hint={t("models.currentTail", { last4: route.key_last4 })}
      />
      {shared > 0 ? (
        <div className={styles.choice}>
          <Checkbox
            label={t("models.shareKey", { count: shared })}
            checked={together}
            onToggle={() => setTogether((v) => !v)}
          />
        </div>
      ) : null}
      <Button
        label={t("models.replace")}
        size="lg"
        busy={busy}
        disabled={!key.trim()}
        onClick={() => void save()}
      />
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
  const { t } = useTranslation();
  const { api } = useApp();
  const first = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState(manualWindowChoice(route.manual_window));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const tokens = manualWindowChoices().find((c) => c.value === choice)?.tokens ?? null;
      onSaved(await api.models.update(route.id, { manual_window: tokens }));
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };
  return (
    <Frame title={t("models.contextWindow")} onClose={onClose} first={first}>
      {error ? <Notice message={error} /> : null}
      <p className={styles.lead}>{t("models.windowSheetNote", { unknown: t("models.manualUnknown") })}</p>
      <Segmented
        label={t("models.contextWindow")}
        value={choice}
        options={manualWindowChoices().map((c) => ({ value: c.value, label: c.label }))}
        onChange={setChoice}
        mono
      />
      <Button label={t("common.save")} size="lg" busy={busy} onClick={() => void save()} />
    </Frame>
  );
}
