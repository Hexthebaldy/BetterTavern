/**
 * 模型（/models；/models/:id 打开这个模型的详情，docs/design/comic 的 07）：漫画格子，不翻页。
 * - 左上“分工”：导演、后台整理、工作台三行，每行一个大字占位、说明和一个选模型的下拉框（直接换，不用点进每个模型）；
 * - 右上一格蓝网点：官方模型剩多少点、大约能写多少回合（服务器没有官方模型时这一格不画，“我的模型”占满右边）；
 * - 右下“我的模型”：状态点、名字、用途标签、服务商、Key 尾号、工作窗口、测试结果（上次测试量到的延迟）；
 *   点一行打开详情（窗口正中的对话框）。
 *   官方模型永远在第一行，服务商和 Key 不写（都是服务器提供的）；
 * - 左下“添加模型”三步，“添加”打开对话框（AddModelForm）；
 * - 页头右边是“连接测试”。外部服务不在这一页（在设置里）。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { Credits, ModelRoute } from "@bettertavern/core/api/types";
import {
  creditsLine,
  modelStatusLabel,
  modelTitle,
  providerName,
  statusKind,
} from "@bettertavern/core/settings/labels";
import { formatTokens } from "@bettertavern/core/utils/format";

import { Bubble, Panel, Portrait } from "../../components/comic.tsx";
import { ComicGrid } from "../../components/ComicGrid.tsx";
import { Button, cx, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { HeaderTool, PageHeader } from "../../components/PageHeader.tsx";
import { creditsKey, routesKey, useCredits, useModelRoutes, useProviders } from "../../data/models.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { Dialog } from "../../overlay/Dialog.tsx";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import overlay from "../../overlay/overlay.module.css";
import { useApp } from "../../state/AppProvider.tsx";
import pages from "../pages.module.css";
import { AddModelForm } from "../settings/AddModelForm.tsx";
import { ModelBody } from "../settings/ModelBody.tsx";
import styles from "./models.module.css";

type Role = "director" | "background" | "workbench";

const ROLE_TONES = { director: "blue", background: "dots", workbench: "grey" } as const;

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
    <div className={pages.page}>
      <PageHeader title={t("nav.models")} sub={t("models.sub")}>
        <HeaderTool icon="probe" label={t("settings.probe")} onClick={() => navigate("/dev/probe")} />
      </PageHeader>
      {routes.error || providers.error ? (
        <Notice
          icon="offline"
          message={t("models.loadFailedWith", { error: describeError(routes.error ?? providers.error) })}
          actionLabel={t("common.retry")}
          onAction={() => {
            void routes.refetch();
            void providers.refetch();
          }}
          className={styles.notice}
        />
      ) : null}
      <ComicGrid paged={false}>
        <Panel hot className={styles.roles} style={{ gridColumn: "1 / span 3", gridRow: "1 / span 2" }}>
          <Roles routes={list} loaded={!!routes.data} />
        </Panel>
        {platform && credits.data ? (
          <CreditsCell credits={credits.data} missing={!!routes.data && !list.some((r) => r.source === "platform")} />
        ) : null}
        <Panel
          className={styles.mine}
          style={{ gridColumn: "4 / span 3", gridRow: platform ? "2 / span 2" : "1 / span 3" }}
        >
          <div className={styles.mineHead}>
            <span className={styles.label}>
              {t("models.mine")}
              {routes.data ? ` · ${list.length}` : null}
            </span>
            <span className={styles.hint}>{t("models.mineHint")}</span>
          </div>
          {routes.data && list.length === 0 ? (
            <div className={styles.empty}>
              <p>{t("settings.noneAdded")}</p>
              <Button label={t("models.add")} icon="plus" variant="blue" size="sm" onClick={() => setAdding(true)} />
            </div>
          ) : (
            <ModelList routes={list} selected={id ?? null} />
          )}
          <span className={styles.footnote}>{t("models.keyOnce")}</span>
        </Panel>
        <Panel tone="dots" className={styles.add} style={{ gridColumn: "1 / span 3", gridRow: "3" }}>
          <div className={styles.addHead}>
            <h2 className={styles.cellTitle}>{t("models.add")}</h2>
            <Button
              label={t("models.addShort")}
              icon="plus"
              variant="blue"
              size="sm"
              onClick={() => setAdding(true)}
              disabled={!providers.data}
            />
          </div>
          <ol className={styles.steps}>
            {(["one", "two", "three"] as const).map((step, i) => (
              <li key={step} className={styles.step}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                {t(`models.addSteps.${step}`)}
              </li>
            ))}
          </ol>
        </Panel>
      </ComicGrid>
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
        <Dialog label={t("models.add")} onClose={() => setAdding(false)} width={780} className={styles.addDialog}>
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

/** 官方模型的点数：蓝网点一格。用完了写明；官方模型那一行被删掉了时带“使用官方模型”按钮 */
function CreditsCell({ credits, missing }: { credits: Credits; missing: boolean }) {
  const { t, i18n } = useTranslation();
  const { api } = useApp();
  const { toast } = useOverlay();
  const queries = useQueryClient();
  const [error, setError] = useState<unknown>(null);
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
  const empty = credits.balance <= 0;
  return (
    <Panel tone="blue" className={styles.credits} style={{ gridColumn: "4 / span 3", gridRow: "1" }}>
      <div className={styles.creditsHead}>
        <Pill tone="ink" label={t("models.officialName")} />
        <span className={styles.creditsLabel}>{t("models.officialTagline")}</span>
      </div>
      {empty ? (
        <p className={styles.creditsEmpty}>{creditsLine(credits)}</p>
      ) : (
        <div className={styles.balance}>
          <span className={styles.balanceNumber}>{credits.balance.toLocaleString(i18n.language)}</span>
          <span className={styles.balanceUnit}>{t("models.points")}</span>
          <span className={styles.turns}>{t("models.turnsLeft", { count: credits.turns_left })}</span>
        </div>
      )}
      <div className={styles.creditsFoot}>
        <span>{t("models.creditsRate")}</span>
        {missing ? (
          <Button label={t("models.officialUse")} variant="secondary" size="sm" onClick={() => void add()} />
        ) : null}
      </div>
      {error ? <Notice message={describeError(error)} className={styles.creditsError} /> : null}
    </Panel>
  );
}

/** 官方模型永远排第一，其余按添加的先后 */
function platformFirst(routes: ModelRoute[]): ModelRoute[] {
  return [...routes].sort((a, b) => Number(b.source === "platform") - Number(a.source === "platform"));
}

/** 一个模型在下拉框里的名字：显示名，后面跟着模型名（显示名就是模型名时不重复） */
function optionLabel(route: ModelRoute): string {
  const title = modelTitle(route);
  return title === route.model ? title : `${title} · ${route.model}`;
}

/** 分工：导演、后台整理、工作台各用哪个模型。后台和工作台可以“跟导演一样”，只能选能调用工具的模型 */
function Roles({ routes, loaded }: { routes: ModelRoute[]; loaded: boolean }) {
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

  const row = (role: Role) => {
    const needsTools = role !== "director";
    const value = current[role]?.id ?? "";
    return (
      <label className={cx(styles.role, role === "director" && styles.roleOn)}>
        <Portrait
          name={t(`models.roles.${role}`)}
          glyph={t(`models.roles.${role}Glyph`)}
          seed={role}
          tone={ROLE_TONES[role]}
          radius={8}
          className={styles.roleFace}
        />
        <span className={styles.roleText}>
          <span className={styles.roleName}>{t(`models.roles.${role}`)}</span>
          <span className={styles.roleNote}>{t(`models.roles.${role}Note`)}</span>
        </span>
        <span className={styles.selectBox}>
          <select
            className={styles.select}
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
                {needsTools && !r.supports_tools ? t("models.roles.noTools", { name: optionLabel(r) }) : optionLabel(r)}
              </option>
            ))}
          </select>
          <Icon name="down" size={16} strokeWidth={2.2} />
        </span>
      </label>
    );
  };

  return (
    <section className={styles.rolesBody} aria-label={t("models.roles.title")}>
      <div className={styles.rolesHead}>
        <h2 className={styles.cellTitle}>{t("models.roles.title")}</h2>
        <span className={styles.hint}>{t("models.roles.lead")}</span>
      </div>
      <Bubble who={t("models.roles.director")} tail="right" small className={styles.directorLine}>
        {t("models.roles.directorLine")}
      </Bubble>
      {row("director")}
      {row("background")}
      {row("workbench")}
      {loaded && routes.length > 0 && !current.director ? (
        <p className={styles.rolesWarn}>{t("settings.cantStart")}</p>
      ) : null}
    </section>
  );
}

function ModelList({ routes, selected }: { routes: ModelRoute[]; selected: string | null }) {
  const { t } = useTranslation();
  const providers = useProviders();
  const path = (route: ModelRoute): string =>
    route.id === selected ? "/models" : `/models/${encodeURIComponent(route.id)}`;
  return (
    <ul className={styles.list}>
      {routes.map((route) => {
        const title = modelTitle(route);
        const official = route.source === "platform";
        const kind = statusKind(route.status);
        const sub = [
          official ? t("models.officialKey") : providerName(route.provider, providers.data),
          official ? null : t("settings.keyTail", { last4: route.key_last4 }),
          t("settings.workingWindow", { size: formatTokens(route.window.model_window) }),
        ]
          .filter(Boolean)
          .join(" · ");
        // 上次测试的延迟（取第一项通过、量到了时间的检查）
        const latency =
          kind === "ok" ? route.last_probe?.checks.find((c) => c.ok && c.latency_ms !== null)?.latency_ms : null;
        const status = [
          modelStatusLabel(route.status),
          latency != null ? `${Math.round(latency)}ms` : null,
          route.supports_tools ? null : t("models.noToolsShort"),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={route.id}>
            <Link
              to={path(route)}
              className={cx(styles.row, route.id === selected && styles.rowOn)}
              aria-current={route.id === selected ? "true" : undefined}
            >
              <span className={cx(styles.dot, kind !== "ok" && styles.dotOff, kind === "invalid" && styles.dotBad)} />
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>
                  <span className={styles.rowName}>{title}</span>
                  {official ? <Pill tone="card" label={t("models.officialPill")} /> : null}
                  {route.is_director ? <Pill tone="acc" label={t("models.directorPill")} /> : null}
                  {route.is_background ? <Pill tone="ink" label={t("models.backgroundPill")} /> : null}
                  {route.is_workbench ? <Pill tone="ink" label={t("models.workbenchPill")} /> : null}
                </span>
                <span className={styles.rowSub}>{sub}</span>
              </span>
              <span className={cx(styles.rowStatus, kind === "invalid" && styles.rowBad)}>{status}</span>
              <Icon name="chevronRight" size={18} strokeWidth={2.2} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
