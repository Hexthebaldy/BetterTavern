/**
 * 设置（W13–W17）。地址和 App 一致：/settings、/settings/models、/settings/model/:id、/settings/account、/dev/probe。
 *
 * - ≥ 900：两栏。左栏 340 是设置首页（SettingsList），右栏从左栏右边 24 开始，到窗口右边留 12，上下各留 12，
 *   圆角 32，灰底白卡（.surface-raised），自己滚动；右栏宽于 720 时，模型详情、添加模型、连接测试分两栏（容器查询）。
 *   从模型列表点进模型详情时，右栏顶上是“‹ 模型”胶囊。/settings 本身：有导演时右栏是导演模型的详情，没有时是模型列表。
 * - 更窄：/settings 是列表；子页单栏，左上角返回。
 */

import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { i18n } from "@bettertavern/core/i18n/index";

import { IconButton } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useModelRoutes } from "../../data/models.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { desktop } from "../../theme/layout.ts";
import pages from "../pages.module.css";
import { ModelBody } from "./ModelBody.tsx";
import { ModelsBody } from "./ModelsBody.tsx";
import { SettingsList } from "./SettingsList.tsx";
import styles from "./settings.module.css";

type FromState = { from?: "models" } | null;

/** 从模型列表进来的模型详情：返回到模型列表 */
function parentOf(pathname: string, state: FromState): { to: string; label: string } {
  if (pathname.startsWith("/settings/model/") && state?.from === "models")
    return { to: "/settings/models", label: i18n.t("settings.pages.models") };
  return { to: "/settings", label: i18n.t("nav.settings") };
}

export function SettingsLayout() {
  const { t } = useTranslation();
  const width = useWindowWidth();
  const wide = width >= desktop.rail;
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  const atRoot = pathname === "/settings";

  if (!wide) {
    if (atRoot) {
      return (
        <div className={pages.page}>
          <Title text={t("nav.settings")} />
          <PageHeader title={t("nav.settings")} />
          <SettingsList wide={false} />
        </div>
      );
    }
    const parent = parentOf(pathname, state as FromState);
    return (
      <div className={styles.single}>
        <IconButton
          icon="back"
          label={t("settings.backTo", { page: parent.label })}
          className={styles.backButton}
          onClick={() => navigate(parent.to)}
        />
        <Outlet />
      </div>
    );
  }

  const parent =
    pathname.startsWith("/settings/model/") && (state as FromState)?.from === "models"
      ? parentOf(pathname, state as FromState)
      : null;
  return (
    <div className={styles.split}>
      <div className={styles.list}>
        <PageHeader title={t("nav.settings")} />
        <SettingsList wide />
      </div>
      <section className={`${styles.pane} surface-raised`} aria-label={t("settings.detail")}>
        <div className={styles.paneScroll}>
          {parent ? (
            <Link to={parent.to} className={styles.backPill}>
              <Icon name="back" size={18} />
              {parent.label}
            </Link>
          ) : null}
          <Outlet />
        </div>
      </section>
    </div>
  );
}

/** 标签页标题（子页各自设；只有首页由这里设） */
function Title({ text }: { text: string }) {
  useDocumentTitle(text);
  return null;
}

/** /settings 本身：宽屏时右栏默认打开导演模型（没有导演时是模型列表）；窄屏只有左边的列表 */
export function SettingsIndex() {
  const { t } = useTranslation();
  const width = useWindowWidth();
  const routes = useModelRoutes();
  if (width < desktop.rail) return null;
  const director = routes.data?.find((r) => r.is_director);
  return (
    <>
      <Title text={t("nav.settings")} />
      {routes.data ? (
        director ? (
          <ModelBody id={director.id} titled={false} />
        ) : (
          <ModelsBody titled={false} />
        )
      ) : null}
    </>
  );
}
