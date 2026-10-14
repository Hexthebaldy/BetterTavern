/**
 * 密钥与端点：列出已添加的密钥，添加新的（DeepSeek、Hugging Face 或任意 OpenAI 兼容端点）。
 * Key 只在这里输入一次，经 TLS 发给服务端加密保存；之后界面只显示后四位，设备上不保存。
 */

import { useRouter } from "expo-router";
import { useState } from "react";

import { describeError } from "../../src/api/client.ts";
import type { Credential, Provider } from "../../src/api/types.ts";
import {
  Body,
  Button,
  Field,
  GroupLabel,
  ListRow,
  Loading,
  Notice,
  Page,
  Segmented,
} from "../../src/components/ui.tsx";
import { CREDENTIAL_STATUS, credentialTitle } from "../../src/features/settings/labels.ts";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { space, usePalette } from "../../src/theme/index.ts";

function AddCredential({ providers, onAdded }: { providers: Provider[]; onAdded: (c: Credential) => void }) {
  const { api } = useApp();
  const [provider, setProvider] = useState(providers[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = providers.find((p) => p.id === provider);
  const needsUrl = selected?.requires_base_url ?? false;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.credentials.create({
        provider,
        label: label.trim(),
        api_key: key.trim(),
        base_url: baseUrl.trim() || null,
      });
      setKey("");
      onAdded(created);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error ? <Notice message={error} /> : null}
      <Segmented
        label="服务商"
        value={provider}
        options={providers.map((p) => ({ value: p.id, label: p.display_name }))}
        onChange={setProvider}
      />
      <Field
        label="API Key"
        value={key}
        onChangeText={setKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        hint="只发送这一次，服务端加密保存；之后只显示后四位"
      />
      <Field
        label={needsUrl ? "端点地址" : "端点地址（可选）"}
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={selected?.default_base_url ?? "https://example.com/v1"}
        hint={needsUrl ? "OpenAI 兼容接口的地址，通常以 /v1 结尾" : "留空使用官方地址"}
      />
      <Field
        label="备注名（可选）"
        value={label}
        onChangeText={setLabel}
        maxLength={60}
        placeholder="例如：我的 DeepSeek"
      />
      <Button
        label="保存密钥"
        onPress={() => void save()}
        busy={busy}
        disabled={!key.trim() || (needsUrl && !baseUrl.trim())}
      />
    </>
  );
}

export default function CredentialsScreen() {
  const { api } = useApp();
  const router = useRouter();
  const palette = usePalette();
  const { data, error, loading, refreshing, reload } = useAsync(async () => {
    const [providers, credentials] = await Promise.all([api.credentials.providers(), api.credentials.list()]);
    return { providers, credentials };
  }, [api]);
  const [adding, setAdding] = useState(false);

  if (loading && !data) return <Loading />;
  const providers = data?.providers ?? [];
  const credentials = data?.credentials ?? [];
  const showForm = adding || (data !== undefined && credentials.length === 0);

  return (
    <Page refreshing={refreshing} onRefresh={() => void reload()}>
      {error ? (
        <Notice message={describeError(error)} actionLabel="重试" onAction={() => void reload()} />
      ) : null}
      {credentials.length > 0 ? (
        <>
          {credentials.map((c) => (
            <ListRow
              key={c.id}
              title={credentialTitle(c, providers)}
              subtitle={`尾号 ${c.key_last4}，${CREDENTIAL_STATUS[c.status]}`}
              onPress={() => router.push({ pathname: "/settings/credential/[id]", params: { id: c.id } })}
            />
          ))}
        </>
      ) : data ? (
        <Body style={{ color: palette.muted, marginBottom: space.l }}>
          故事由你自己的模型来写。添加一个 API Key，再给导演选一个模型。
        </Body>
      ) : null}
      {showForm && providers.length > 0 ? (
        <>
          <GroupLabel>添加密钥</GroupLabel>
          <AddCredential
            providers={providers}
            onAdded={(created) => {
              setAdding(false);
              void reload();
              router.push({ pathname: "/settings/credential/[id]", params: { id: created.id } });
            }}
          />
        </>
      ) : data ? (
        <Button
          label="添加密钥"
          variant="secondary"
          onPress={() => setAdding(true)}
          style={{ marginTop: space.xl }}
        />
      ) : null}
    </Page>
  );
}
