/**
 * 外部服务（/settings/tools，设置的子页面；旧地址 /tools 跳过来）：工作台的 agent 查资料、读网页、生成封面时用的服务，
 * 以及阅读页朗读用的语音服务。分四种，宽屏时三栏并排（每栏一个描边的格子）：
 * - 网页搜索：Tavily、Brave、博查要 Key，SearXNG 填自己架的地址；
 * - 读网页：默认由服务器自己读，不用配；可选 Jina，读不出来的网页换它再读；
 * - 生成封面：按接口协议接（OpenAI Images、对话接口出图、Gemini），填地址、模型名和 Key；
 * - 朗读：按接口协议接（OpenAI 语音接口、Gemini、ElevenLabs），填地址、模型名和 Key，可以填默认声音。
 * 每一种可以配几个，其中一个是默认；可以测试（真的搜一个词、读一个页面、出一张小图或者读一句话）、设为默认、编辑、删除。
 * 添加和编辑用同一个对话框：编辑时服务商不能换，Key 留空表示不换，只发改了的字段；换了 Key、地址或模型名就再测一次。
 * 朗读服务测试成功时把试听的那句话放出来。
 * Key 只在添加和编辑时输入，之后只显示后四位。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";
import type { ToolKind, ToolProvider, ToolRoute } from "@bettertavern/core/api/types";
import { i18n } from "@bettertavern/core/i18n/index";
import { newToolRoute, toolFormFrom, toolFormReady, toolPatch, type ToolForm } from "@bettertavern/core/settings/tools";

import { Link } from "react-router";

import { Panel } from "../../components/comic.tsx";
import { Button, Chip, cx, Field, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { toolRoutesKey, useToolProviders, useToolRoutes } from "../../data/tools.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import pages from "../pages.module.css";
import { KeyField } from "../settings/parts.tsx";
import { StatusPill } from "../settings/StatusPill.tsx";
import tools from "./tools.module.css";

const KINDS: ToolKind[] = ["search", "fetch", "image", "speech"];

function providerLabel(id: string): string {
  return i18n.t(`tools.providers.${id as "tavily"}`, { defaultValue: id });
}

/** 添加一个服务；带 route 时是编辑它：服务商不能换，Key 留空表示不换 */
function RouteDialog({
  kind,
  route,
  providers,
  onClose,
  onAdded,
  onEdited,
}: {
  kind: ToolKind;
  route?: ToolRoute;
  providers: ToolProvider[];
  onClose: () => void;
  onAdded: (route: ToolRoute) => void;
  onEdited: (route: ToolRoute, retest: boolean) => void;
}) {
  const { t } = useTranslation();
  const { api } = useApp();
  const options = providers.filter((p) => (route ? p.id === route.provider : p.kinds.includes(kind)));
  const [provider, setProvider] = useState(options[0]?.id ?? "");
  const [form, setForm] = useState(() => toolFormFrom(route));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = options.find((p) => p.id === provider);
  const ready = toolFormReady(selected, form, route);
  const edit = (patch: Partial<ToolForm>): void => setForm((old) => ({ ...old, ...patch }));

  const save = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (route) {
        const { patch, retest } = toolPatch(route, form);
        onEdited(Object.keys(patch).length ? await api.tools.update(route.id, patch) : route, retest);
      } else {
        onAdded(await api.tools.create(newToolRoute(kind, provider, form)));
      }
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const title = route
    ? t("tools.editTitle", { name: route.label || providerLabel(route.provider) })
    : t("tools.addTitle", { kind: t(`tools.kinds.${kind}`) });
  return (
    <Dialog label={title} onClose={onClose} width={480}>
      <div className={tools.dialog}>
        <h2 className={tools.dialogTitle}>{title}</h2>
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
              label={route?.has_key ? t("tools.apiKeyKeep") : selected.needs_key ? t("tools.apiKey") : t("tools.apiKeyOptional")}
              hint={route?.has_key ? t("tools.keyTail", { last4: route.key_last4 }) : undefined}
              value={form.key}
              onChange={(e) => edit({ key: e.target.value })}
            />
            <Field
              label={selected.needs_base_url ? t("tools.baseUrl") : t("tools.baseUrlOptional")}
              value={form.baseUrl}
              placeholder="https://"
              inputMode="url"
              onChange={(e) => edit({ baseUrl: e.target.value })}
            />
            {selected.needs_model ? (
              <Field label={t("tools.model")} value={form.model} onChange={(e) => edit({ model: e.target.value })} />
            ) : null}
            {kind === "speech" ? (
              <Field
                label={t("tools.voice")}
                optional
                hint={t("tools.voiceHint")}
                value={form.voice}
                maxLength={200}
                onChange={(e) => edit({ voice: e.target.value })}
              />
            ) : null}
            <Field
              label={t("tools.label")}
              optional
              value={form.label}
              maxLength={60}
              onChange={(e) => edit({ label: e.target.value })}
            />
          </>
        ) : null}
        {error ? <Notice message={error} /> : null}
        <div className={tools.dialogButtons}>
          <Button label={t("common.cancel")} variant="secondary" onClick={onClose} />
          <Button
            label={route ? t("common.save") : t("tools.add")}
            busy={busy}
            disabled={!ready}
            onClick={() => void save()}
          />
        </div>
      </div>
    </Dialog>
  );
}

function RouteRow({ route, onChanged, onEdit }: { route: ToolRoute; onChanged: () => void; onEdit: () => void }) {
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
      if (route.kind === "speech" && next.status === "ok") {
        const { data, mime } = await api.speech.synthesize({ text: t("play.speech.sample"), route_id: route.id });
        const url = URL.createObjectURL(new Blob([data], { type: mime || "audio/mpeg" }));
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
      }
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
    <div className={cx(tools.row, route.is_default && tools.rowDefault)}>
      <div className={tools.rowHead}>
        <span className={tools.rowText}>
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
        <Button label={t("tools.edit")} size="sm" variant="text" onClick={onEdit} />
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
  // 正在添加哪一种，或者正在编辑哪一个
  const [dialog, setDialog] = useState<{ kind: ToolKind; route?: ToolRoute } | null>(null);
  const refresh = (): void => void queries.invalidateQueries({ queryKey: toolRoutesKey });

  return (
    <div className={cx(pages.page, tools.page)}>
      <PageHeader title={t("nav.tools")} sub={t("settings.toolsSub")} />
      <Link to="/settings" className={tools.back}>
        <Icon name="arrowLeft" size={16} strokeWidth={2.2} />
        {t("nav.settings")}
      </Link>
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
          className={tools.notice}
        />
      ) : null}
      <div className={tools.columns}>
        {KINDS.map((kind) => {
          const list = (routes.data ?? []).filter((r) => r.kind === kind);
          return (
            <Panel as="section" key={kind} className={tools.column} aria-labelledby={`tools-${kind}`}>
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
                  onClick={() => setDialog({ kind })}
                />
              </div>
              <p className={tools.columnNote}>{t(`tools.kindNotes.${kind}`)}</p>
              {list.length ? (
                <div className={tools.list}>
                  {list.map((route) => (
                    <RouteRow key={route.id} route={route} onChanged={refresh} onEdit={() => setDialog({ kind, route })} />
                  ))}
                </div>
              ) : routes.data ? (
                <p className={tools.none}>{t("tools.none")}</p>
              ) : null}
            </Panel>
          );
        })}
      </div>
      {dialog && providers.data ? (
        <RouteDialog
          kind={dialog.kind}
          route={dialog.route}
          providers={providers.data}
          onClose={() => setDialog(null)}
          onAdded={(route) => {
            setDialog(null);
            refresh();
            overlay.toast(t("tools.saved"));
            // 加好就测一次，马上知道能不能用（结果显示在这一行的状态上）
            void api.tools
              .test(route.id)
              .catch(() => undefined)
              .finally(refresh);
          }}
          onEdited={(route, retest) => {
            setDialog(null);
            refresh();
            overlay.toast(t("tools.updated"));
            // 换了 Key、地址或模型名：再测一次
            if (retest) void api.tools.test(route.id).catch(() => undefined).finally(refresh);
          }}
        />
      ) : null}
    </div>
  );
}
