/**
 * 模型（W13，同 App 的 ModelsBody）：上面是配好的模型（导演那一行带“导演”标记），下面是添加模型的表单。
 * Key 只在添加时输入一次，经 TLS 发给服务端加密保存；之后界面只显示后四位，浏览器里不保存。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoute } from "@bettertavern/core/api/types";
import { modelStatusLabel, modelTitle, statusKind } from "@bettertavern/core/settings/labels";
import { formatTokens } from "@bettertavern/core/utils/format";

import { cx, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { routesKey, useModelRoutes, useProviders } from "../../data/models.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { AddModelForm } from "./AddModelForm.tsx";
import { BodyHead, ProviderMark, SectionHeader } from "./parts.tsx";
import styles from "./settings.module.css";
import { StatusPill } from "./StatusPill.tsx";

function ModelRow({ route }: { route: ModelRoute }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/settings/model/${encodeURIComponent(route.id)}`}
      state={{ from: "models" }}
      className={styles.modelRow}
      aria-label={t(route.is_director ? "models.rowLabelDirector" : "models.rowLabel", {
        name: modelTitle(route),
      })}
    >
      <ProviderMark provider={route.provider} tone={route.is_director ? "ink" : "card"} />
      <span className={styles.rowText}>
        <span className={cx(styles.modelName, !route.label && styles.mono)}>{modelTitle(route)}</span>
        <span className={styles.modelMeta}>
          <span className={styles.monoSmall}>
            {route.label ? `${route.model} · ` : ""}•••• {route.key_last4} ·{" "}
            {formatTokens(route.window.model_window)}
          </span>
          <StatusPill kind={statusKind(route.status)} label={modelStatusLabel(route.status)} />
        </span>
      </span>
      {route.is_director ? (
        <Pill label={t("models.directorPill")} tone="acc" />
      ) : (
        <Icon name="chevronRight" size={18} className={styles.chevron} />
      )}
    </Link>
  );
}

export function ModelsBody({ titled = true }: { titled?: boolean }) {
  const { t } = useTranslation();
  const routes = useModelRoutes();
  const providers = useProviders();
  const queries = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className={styles.body}>
      {titled ? <Title /> : null}
      <BodyHead title={t("models.title")} lead={t("models.intro")} />
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
      {routes.data && routes.data.length > 0 ? (
        <div className={styles.modelList}>
          {routes.data.map((r) => (
            <ModelRow key={r.id} route={r} />
          ))}
        </div>
      ) : null}
      <SectionHeader title={t("models.add")} />
      {providers.data && providers.data.length > 0 && routes.data ? (
        <AddModelForm
          providers={providers.data}
          routes={routes.data}
          onAdded={(created) => {
            void queries.invalidateQueries({ queryKey: routesKey });
            navigate(`/settings/model/${encodeURIComponent(created.id)}`, { state: { from: "models" } });
          }}
        />
      ) : null}
    </div>
  );
}

function Title() {
  const { t } = useTranslation();
  useDocumentTitle(t("models.title"));
  return null;
}
