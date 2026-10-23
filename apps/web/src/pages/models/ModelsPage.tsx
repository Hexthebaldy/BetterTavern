/**
 * 模型（/models；/models/:id 打开这个模型的详情）。照电脑上的习惯排，不照搬手机的“列表 → 详情”：
 * - 页头：标题和数量；右边是官方模型的余额和“添加模型”（打开对话框，里面是 AddModelForm）；
 * - “分工”：导演、后台整理、工作台各用哪个模型，三个下拉框直接换（不用点进每个模型拨开关）；
 * - 模型表格：名字、服务商、Key、上下文、状态、用途。官方模型永远在第一行，标记是 BetterTavern 的 Logo，
 *   服务商和 Key 两格空着（都是服务器提供的）；
 * - 点一行打开详情（ModelBody）：在窗口正中的对话框里，够宽时分两栏；关上回到 /models。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { Credits, ModelRoute } from "@bettertavern/core/api/types";
import {
  creditsLine,
  keyText,
  modelStatusLabel,
  modelTitle,
  providerName,
  statusKind,
} from "@bettertavern/core/settings/labels";
import { formatTokens } from "@bettertavern/core/utils/format";

import { Button, cx, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Logo } from "../../components/Logo.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { creditsKey, routesKey, useCredits, useModelRoutes, useProviders } from "../../data/models.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import overlay from "../../overlay/overlay.module.css";
import { useApp } from "../../state/AppProvider.tsx";
import pages from "../pages.module.css";
import { AddModelForm } from "../settings/AddModelForm.tsx";
import { ModelBody } from "../settings/ModelBody.tsx";
import { ProviderMark } from "../settings/parts.tsx";
import { StatusPill } from "../settings/StatusPill.tsx";
import styles from "./models.module.css";

type Role = "director" | "background" | "workbench";

export function ModelsPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  useDocumentTitle(t("nav.models"));
  const navigate = useNavigate();
  const queries = useQueryClient();
  const routes = useModelRoutes();
  const providers = useProviders();
  const credits = useCredits();
  const [adding, setAdding] = useState(false);
  const platform = credits.data?.platform === true;
  const list = platformFirst(routes.data ?? []);

  return (
    <div className={cx(pages.page, styles.page)}>
      <PageHeader title={t("nav.models")} count={routes.data ? list.length : null}>
        {platform && credits.data && credits.data.balance > 0 ? (
          <span className={styles.balance}>{creditsLine(credits.data)}</span>
        ) : null}
        <Button label={t("models.add")} icon="plus" onClick={() => setAdding(true)} disabled={!providers.data} />
      </PageHeader>
      <p className={styles.lead}>{platform ? t("models.introPlatform") : t("models.intro")}</p>
      {routes.error || providers.error ? (
        <Notice
          icon="offline"
          message={t("models.loadFailedWith", { error: describeError(routes.error ?? providers.error) })}
          actionLabel={t("common.retry")}
          onAction={() => {
            void routes.refetch();
            void providers.refetch();
          }}
        />
      ) : null}
      {platform && credits.data && routes.data ? (
        <CreditsNotice credits={credits.data} missing={!list.some((r) => r.source === "platform")} />
      ) : null}
      {routes.data ? <Roles routes={list} /> : null}
      {routes.data && list.length === 0 ? (
        <div className={styles.empty}>
          <p>{t("settings.noneAdded")}</p>
          <Button label={t("models.add")} icon="plus" variant="secondary" onClick={() => setAdding(true)} />
        </div>
      ) : (
        <ModelTable routes={list} selected={id ?? null} />
      )}
      {id ? (
        <Dialog
          key={id}
          label={t("settings.detail")}
          onClose={() => navigate("/models")}
          width={880}
          className={styles.detailDialog}
          bare
        >
          <div className={styles.detailBody}>
            <IconButton
              icon="close"
              label={t("common.close")}
              diameter={36}
              iconSize={18}
              className={styles.detailClose}
              onClick={() => navigate("/models")}
            />
            <ModelBody id={id} titled={false} />
          </div>
        </Dialog>
      ) : null}
      {adding && providers.data && routes.data ? (
        <Dialog
          label={t("models.add")}
          onClose={() => setAdding(false)}
          width={780}
          className={styles.addDialog}
        >
          <h2 className={overlay.dialogTitle}>{t("models.add")}</h2>
          <AddModelForm
            providers={providers.data}
            routes={list}
            onAdded={(created) => {
              setAdding(false);
              void queries.invalidateQueries({ queryKey: routesKey });
              void queries.invalidateQueries({ queryKey: creditsKey });
              navigate(`/models/${encodeURIComponent(created.id)}`);
            }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

/** 官方模型的余额；用完了是黄色的提示；官方模型那一行被删掉了时带“使用官方模型”按钮 */
function CreditsNotice({ credits, missing }: { credits: Credits; missing: boolean }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const { toast } = useOverlay();
  const queries = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  if (credits.balance > 0 && !missing && !error) return null;
  const add = async (): Promise<void> => {
    setError(null);
    try {
      await api.models.addPlatform();
      void queries.invalidateQueries({ queryKey: routesKey });
      void queries.invalidateQueries({ queryKey: creditsKey });
      toast(t("models.officialAdded"));
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className={styles.notices}>
      <Notice
        tone={credits.balance > 0 ? "info" : "warn"}
        message={creditsLine(credits)}
        actionLabel={missing ? t("models.officialUse") : undefined}
        onAction={missing ? () => void add() : undefined}
      />
      {error ? <Notice message={describeError(error)} /> : null}
    </div>
  );
}

/** 官方模型永远排第一，其余按添加的先后 */
function platformFirst(routes: ModelRoute[]): ModelRoute[] {
  return [...routes].sort((a, b) => Number(b.source === "platform") - Number(a.source === "platform"));
}

/** 官方模型的标记：白底圆里是 BetterTavern 的 Logo（Logo 的线条是墨色，所以底不跟着导演变黑） */
function OfficialMark() {
  return (
    <span className={styles.officialMark} aria-hidden="true">
      <Logo size={20} label={null} />
    </span>
  );
}

/** 一个模型在下拉框里的名字：显示名，后面跟着模型名（显示名就是模型名时不重复） */
function optionLabel(route: ModelRoute): string {
  const title = modelTitle(route);
  return title === route.model ? title : `${title} · ${route.model}`;
}

/** 分工：导演、后台整理、工作台各用哪个模型。后台和工作台可以“跟导演一样”，只能选能调用工具的模型 */
function Roles({ routes }: { routes: ModelRoute[] }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const { toast } = useOverlay();
  const queries = useQueryClient();
  const [busy, setBusy] = useState<Role | null>(null);
  const current: Record<Role, ModelRoute | undefined> = {
    director: routes.find((r) => r.is_director),
    background: routes.find((r) => r.is_background),
    workbench: routes.find((r) => r.is_workbench),
  };

  const change = async (role: Role, id: string): Promise<void> => {
    setBusy(role);
    try {
      if (id) await api.models.update(id, { [role]: true });
      else if (current[role]) await api.models.update(current[role].id, { [role]: false });
      void queries.invalidateQueries({ queryKey: routesKey });
      void queries.invalidateQueries({ queryKey: creditsKey });
      void queries.invalidateQueries({ queryKey: ["model-route"] });
      toast(t(`models.roles.changed.${role}`));
    } catch (e) {
      toast(describeError(e), { icon: "alert" });
    } finally {
      setBusy(null);
    }
  };

  const select = (role: Role) => {
    const needsTools = role !== "director";
    const value = current[role]?.id ?? "";
    return (
      <label className={styles.role}>
        <span className={styles.roleName}>{t(`models.roles.${role}`)}</span>
        <span className={styles.roleNote}>{t(`models.roles.${role}Note`)}</span>
        <select
          className={styles.roleSelect}
          value={value}
          disabled={busy !== null || routes.length === 0}
          onChange={(e) => void change(role, e.target.value)}
        >
          {role === "director" ? (
            value ? null : (
              <option value="" disabled>
                {t("settings.notSet")}
              </option>
            )
          ) : (
            <option value="">{t("models.roles.sameAsDirector")}</option>
          )}
          {routes.map((r) => (
            <option key={r.id} value={r.id} disabled={needsTools && !r.supports_tools && r.id !== value}>
              {needsTools && !r.supports_tools
                ? t("models.roles.noTools", { name: optionLabel(r) })
                : optionLabel(r)}
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <section className={styles.roles} aria-label={t("models.roles.title")}>
      {select("director")}
      {select("background")}
      {select("workbench")}
      {routes.length > 0 && !current.director ? (
        <p className={styles.rolesWarn}>{t("settings.cantStart")}</p>
      ) : null}
    </section>
  );
}

function ModelTable({ routes, selected }: { routes: ModelRoute[]; selected: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const providers = useProviders();
  const path = (route: ModelRoute): string =>
    route.id === selected ? "/models" : `/models/${encodeURIComponent(route.id)}`;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{t("models.columns.name")}</th>
          <th scope="col">{t("models.provider")}</th>
          <th scope="col">Key</th>
          <th scope="col">{t("models.context")}</th>
          <th scope="col">{t("models.columns.status")}</th>
          <th scope="col">{t("models.columns.roles")}</th>
        </tr>
      </thead>
      <tbody>
        {routes.map((route) => {
          const title = modelTitle(route);
          const official = route.source === "platform";
          return (
            <tr
              key={route.id}
              className={cx(styles.tr, route.id === selected && styles.trOn)}
              aria-selected={route.id === selected}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) return;
                navigate(path(route));
              }}
            >
              <td>
                <Link to={path(route)} className={styles.nameCell}>
                  {official ? (
                    <OfficialMark />
                  ) : (
                    <ProviderMark provider={route.provider} size={32} tone={route.is_director ? "ink" : "card"} />
                  )}
                  <span className={styles.nameText}>
                    <span className={cx(styles.name, title === route.model && styles.mono)}>{title}</span>
                    {title !== route.model ? <span className={styles.sub}>{route.model}</span> : null}
                  </span>
                </Link>
              </td>
              <td className={styles.dim}>{official ? null : providerName(route.provider, providers.data)}</td>
              <td className={cx(styles.dim, styles.mono)}>{official ? null : keyText(route)}</td>
              <td className={cx(styles.dim, styles.mono)}>{formatTokens(route.window.model_window)}</td>
              <td>
                <StatusPill kind={statusKind(route.status)} label={modelStatusLabel(route.status)} />
              </td>
              <td>
                <span className={styles.pills}>
                  {route.is_director ? <Pill label={t("models.directorPill")} tone="acc" /> : null}
                  {route.is_background ? <Pill label={t("models.backgroundPill")} /> : null}
                  {route.is_workbench ? <Pill label={t("models.workbenchPill")} /> : null}
                  {route.source === "platform" ? <Pill label={t("models.officialPill")} /> : null}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
