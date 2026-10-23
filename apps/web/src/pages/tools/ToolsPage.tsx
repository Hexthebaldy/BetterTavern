/**
 * 外部服务（/tools，侧栏“连接”里的一项）：工作台的 agent 查资料、读网页、生成封面时用的服务，分三种，宽屏时三栏并排：
 * - 网页搜索：Tavily、Brave、博查要 Key，SearXNG 填自己架的地址；
 * - 读网页：默认由服务器自己读，不用配；可选 Jina，读不出来的网页换它再读；
 * - 生成封面：按接口协议接（OpenAI Images、对话接口出图、Gemini），填地址、模型名和 Key。
 * 每一种可以配几个，其中一个是默认；可以测试（真的搜一个词、读一个页面或者出一张小图）、设为默认、换 Key、删除。
 * Key 只在添加和更换时输入一次，之后只显示后四位。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";
import type { ToolKind, ToolProvider, ToolRoute } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";

import { Button, Chip, cx, Field, Notice, Pill } from "../../components/controls.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { toolRoutesKey, useToolProviders, useToolRoutes } from "../../data/tools.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import pages from "../pages.module.css";
import { KeyField } from "../settings/parts.tsx";
import styles from "../settings/settings.module.css";
import { StatusPill } from "../settings/StatusPill.tsx";
import tools from "./tools.module.css";

const KINDS: ToolKind[] = ["search", "fetch", "image"];

function providerLabel(id: string): string {
  return i18n.t(`tools.providers.${id as "tavily"}`, { defaultValue: id });
}

function AddDialog({
  kind,
  providers,
  onClose,
  onAdded,
}: {
  kind: ToolKind;
  providers: ToolProvider[];
  onClose: () => void;
  onAdded: (route: ToolRoute) => void;
}) {
  const { t } = useTranslation();
  const { api } = useApp();
  const options = providers.filter((p) => p.kinds.includes(kind));
  const [provider, setProvider] = useState(options[0]?.id ?? "");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = options.find((p) => p.id === provider);
  const ready =
    !!selected &&
    (!selected.needs_key || key.trim() !== "") &&
    (!selected.needs_base_url || baseUrl.trim() !== "") &&
    (!selected.needs_model || model.trim() !== "");

  const save = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.tools.create({
        kind,
        provider,
        label: label.trim() || undefined,
        api_key: key.trim() || null,
        base_url: baseUrl.trim() || null,
        model: model.trim() || null,
      });
      onAdded(created);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const kindName = t(`tools.kinds.${kind}`);
  return (
    <Dialog label={t("tools.addTitle", { kind: kindName })} onClose={onClose} width={480}>
      <div className={tools.dialog}>
        <h2 className={tools.dialogTitle}>{t("tools.addTitle", { kind: kindName })}</h2>
        <div className={tools.chips} role="radiogroup" aria-label={t("tools.provider")}>
          {options.map((p) => (
            <Chip
              key={p.id}
              label={providerLabel(p.id)}
              selected={p.id === provider}
              onClick={() => {
                setProvider(p.id);
                setError(null);
              }}
            />
          ))}
        </div>
        {selected ? (
          <>
            <KeyField
              label={selected.needs_key ? t("tools.apiKey") : t("tools.apiKeyOptional")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Field
              label={selected.needs_base_url ? t("tools.baseUrl") : t("tools.baseUrlOptional")}
              value={baseUrl}
              placeholder="https://"
              inputMode="url"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            {selected.needs_model ? (
              <Field label={t("tools.model")} value={model} onChange={(e) => setModel(e.target.value)} />
            ) : null}
            <Field
              label={t("tools.label")}
              optional
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
            />
          </>
        ) : null}
        {error ? <Notice message={error} /> : null}
        <div className={tools.dialogButtons}>
          <Button label={t("common.cancel")} variant="secondary" onClick={onClose} />
          <Button label={t("tools.add")} busy={busy} disabled={!ready} onClick={() => void save()} />
        </div>
      </div>
    </Dialog>
  );
}

function RouteRow({ route, onChanged }: { route: ToolRoute; onChanged: () => void }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const [testing, setTesting] = useState(false);
  const name = route.label || providerLabel(route.provider);

  const replace = (next: ToolRoute): void => {
    queries.setQueryData<ToolRoute[]>(toolRoutesKey, (list) => list?.map((r) => (r.id === next.id ? next : r)));
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    try {
      const next = await api.tools.test(route.id);
      replace(next);
      const detail = next.probe.detail ?? "";
      overlay.toast(next.status === "ok" ? t("tools.testOk", { detail }) : t("tools.testFailed", { detail }), {
        icon: next.status === "ok" ? "check" : "alert",
      });
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    } finally {
      setTesting(false);
    }
  };

  const makeDefault = async (): Promise<void> => {
    try {
      await api.tools.update(route.id, { default: true });
      onChanged();
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    }
  };

  const replaceKey = async (): Promise<void> => {
    const key = await overlay.prompt({ title: t("tools.replaceKey"), label: t("tools.apiKey") });
    if (!key?.trim()) return;
    try {
      replace(await api.tools.update(route.id, { api_key: key.trim() }));
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("tools.deleteTitle", { name }),
      message: t("tools.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.tools.remove(route.id);
      onChanged();
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const kind = route.status === "ok" ? "ok" : route.status === "invalid" ? "invalid" : "untested";
  const statusLabel =
    route.status === "ok"
      ? t("tools.testOk", { detail: route.probe.detail ?? "" })
      : route.status === "invalid"
        ? t("tools.testFailed", { detail: route.probe.detail ?? "" })
        : t("tools.untested");
  const meta = [
    route.label ? providerLabel(route.provider) : "",
    route.model ?? "",
    route.base_url ?? "",
    route.has_key ? t("tools.keyTail", { last4: route.key_last4 }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={tools.row}>
      <div className={tools.rowHead}>
        <span className={styles.rowText}>
          <span className={tools.name}>{name}</span>
          {meta ? <span className={tools.meta}>{meta}</span> : null}
        </span>
        {route.is_default ? <Pill label={t("tools.default")} tone="acc" /> : null}
      </div>
      <div className={tools.rowFoot}>
        <StatusPill kind={kind} label={statusLabel} />
      </div>
      <div className={tools.actions}>
        <Button label={testing ? t("tools.testing") : t("tools.test")} size="sm" variant="secondary" busy={testing} onClick={() => void test()} />
        {route.is_default ? null : (
          <Button label={t("tools.makeDefault")} size="sm" variant="text" onClick={() => void makeDefault()} />
        )}
        {route.has_key ? (
          <Button label={t("tools.replaceKey")} size="sm" variant="text" onClick={() => void replaceKey()} />
        ) : null}
        <Button label={t("common.delete")} size="sm" variant="danger" onClick={() => void remove()} />
      </div>
    </div>
  );
}

export function ToolsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.tools"));
  const routes = useToolRoutes();
  const providers = useToolProviders();
  const queries = useQueryClient();
  const overlay = useOverlay();
  const { api } = useApp();
  const [adding, setAdding] = useState<ToolKind | null>(null);
  const refresh = (): void => void queries.invalidateQueries({ queryKey: toolRoutesKey });

  return (
    <div className={cx(pages.page, tools.page)}>
      <PageHeader title={t("nav.tools")} />
      <p className={tools.lead}>{t("tools.intro")}</p>
      {routes.error || providers.error ? (
        <Notice
          icon="offline"
          message={t("tools.loadFailed")}
          actionLabel={t("common.retry")}
          onAction={() => {
            void routes.refetch();
            void providers.refetch();
          }}
        />
      ) : null}
      <div className={tools.columns}>
        {KINDS.map((kind) => {
          const list = (routes.data ?? []).filter((r) => r.kind === kind);
          return (
            <section key={kind} className={tools.column} aria-labelledby={`tools-${kind}`}>
              <div className={tools.columnHead}>
                <h2 id={`tools-${kind}`} className={tools.columnTitle}>
                  {t(`tools.kinds.${kind}`)}
                </h2>
                <Button
                  label={t("tools.add")}
                  icon="plus"
                  size="sm"
                  variant="secondary"
                  disabled={!providers.data}
                  onClick={() => setAdding(kind)}
                />
              </div>
              <p className={tools.columnNote}>{t(`tools.kindNotes.${kind}`)}</p>
              {list.length ? (
                <div className={tools.list}>
                  {list.map((route) => (
                    <RouteRow key={route.id} route={route} onChanged={refresh} />
                  ))}
                </div>
              ) : routes.data ? (
                <p className={tools.none}>{t("tools.none")}</p>
              ) : null}
            </section>
          );
        })}
      </div>
      {adding && providers.data ? (
        <AddDialog
          kind={adding}
          providers={providers.data}
          onClose={() => setAdding(null)}
          onAdded={(route) => {
            setAdding(null);
            refresh();
            overlay.toast(t("tools.saved"));
            // 加好就测一次，马上知道能不能用（结果显示在这一行的状态上）
            void api.tools
              .test(route.id)
              .catch(() => undefined)
              .finally(refresh);
          }}
        />
      ) : null}
    </div>
  );
}
