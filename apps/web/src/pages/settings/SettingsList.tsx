/**
 * 设置首页（左栏，同 App 的 app/(tabs)/settings.tsx）：最上面是导演模型卡片（没设置时是琥珀色的引导卡），
 * 下面“配置”（第一行是登录的账户）“其他”两组，最后是版本号。每一项都是链接；宽屏两栏时打开着的那一项白底加 2px 蓝色内描边，
 * 导演模型卡片换成浅灰的。“外观”打开居中对话框（W16），选了立刻生效。
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoute } from "@bettertavern/core/api/types";
import { LANGUAGE_NAMES } from "@bettertavern/core/i18n/index";
import { directorLine, modelStatusLabel, windowSourceLabel } from "@bettertavern/core/settings/labels";
import { formatTokens } from "@bettertavern/core/utils/format";

import { cx, Notice, Pill } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { CLIENT_VERSION } from "../../config.ts";
import { useModelRoutes } from "../../data/models.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { AppearanceDialog } from "./AppearanceDialog.tsx";
import { LanguageDialog } from "./LanguageDialog.tsx";
import styles from "./settings.module.css";

function DirectorCard({ route, light, selected }: { route: ModelRoute; light: boolean; selected: boolean }) {
  const { t } = useTranslation();
  const { model_window: total, working_cap: cap, max_tokens: out } = route.window;
  const used = Math.min(cap, total);
  const story = Math.max(0, used - out) / total;
  const output = Math.min(out, used) / total;
  return (
    <Link
      to={`/settings/model/${encodeURIComponent(route.id)}`}
      className={cx(styles.director, light && styles.directorLight, selected && styles.selected)}
      aria-current={selected ? "page" : undefined}
      aria-label={t("settings.directorLabel", { model: route.model })}
    >
      <span className={styles.cardTop}>
        <span className={styles.faint}>{t("settings.director")}</span>
        <span className={styles.cardStatus}>
          <span className={cx(styles.dot, styles[`dot-${route.status}`])} />
          {modelStatusLabel(route.status)}
        </span>
      </span>
      <span className={styles.cardMain}>
        <span className={styles.cardIcon}>
          <Icon name="director" />
        </span>
        <span className={styles.cardText}>
          <span className={styles.model}>{route.model}</span>
          <span className={styles.faintSmall}>
            {directorLine(route)}
          </span>
        </span>
        {light ? null : <Icon name="chevronRight" size={18} />}
      </span>
      <span className={styles.windowBar} aria-hidden="true">
        <span className={styles.barStory} style={{ flex: story }} />
        <span className={styles.barOutput} style={{ flex: output }} />
        <span style={{ flex: Math.max(0, 1 - story - output) }} />
      </span>
      <span className={styles.cardTop}>
        <span className={styles.small}>{t("settings.workingWindow", { size: formatTokens(used) })}</span>
        <span className={styles.small}>
          {t("settings.context", { size: formatTokens(total) })}
          {route.window.source === "default" ? ` (${windowSourceLabel("default")})` : ""}
        </span>
      </span>
    </Link>
  );
}

function SetupCard({ hasModels }: { hasModels: boolean }) {
  const { t } = useTranslation();
  const step = (n: number, label: string, current: boolean, done: boolean) => (
    <div className={cx(styles.setupStep, current && styles.setupCurrent)}>
      <span className={cx(styles.setupKey, current && styles.setupKeyOn)}>
        {done ? <Icon name="check" size={14} strokeWidth={2.4} /> : n}
      </span>
      {label}
    </div>
  );
  return (
    <div className={styles.setup}>
      <Pill tone="warn" icon="alert" label={t("settings.cantStart")} />
      <h2 className={styles.setupTitle}>{t("settings.setupTitle")}</h2>
      <div className={styles.setupSteps}>
        {step(1, t("settings.setupStep1"), !hasModels, hasModels)}
        {step(2, t("settings.setupStep2"), hasModels, false)}
      </div>
      <Link to="/settings/models" className={styles.setupGo}>
        {hasModels ? t("settings.pickDirector") : t("settings.addModel")}
        <span className={styles.setupArrow}>
          <Icon name="arrowRight" size={18} />
        </span>
      </Link>
    </div>
  );
}

function Row({
  to,
  icon,
  leading,
  title,
  subtitle,
  subtitleTone,
  trailing,
  selected,
  onClick,
}: {
  to?: string;
  icon?: IconName;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  subtitleTone?: "warn";
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      {leading ?? (
        <span className={styles.rowIcon}>
          <Icon name={icon ?? "settings"} size={20} />
        </span>
      )}
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        {subtitle ? (
          <span className={cx(styles.rowSub, subtitleTone && styles.warnText)}>{subtitle}</span>
        ) : null}
      </span>
      {trailing}
      {to ? <Icon name="chevronRight" size={18} className={styles.chevron} /> : null}
    </>
  );
  return to ? (
    <Link
      to={to}
      className={cx(styles.row, selected && styles.selected)}
      aria-current={selected ? "page" : undefined}
    >
      {body}
    </Link>
  ) : (
    <button type="button" className={styles.row} onClick={onClick}>
      {body}
    </button>
  );
}

/** 宽屏两栏时，路径对应左栏里的哪一项 */
export function selectedItem(
  pathname: string,
  director: ModelRoute | null,
): "director" | "models" | "tools" | "account" | "probe" | null {
  if (pathname.startsWith("/settings/account")) return "account";
  if (pathname.startsWith("/settings/tools")) return "tools";
  if (pathname.startsWith("/dev/probe")) return "probe";
  if (pathname.startsWith("/settings/models")) return "models";
  if (pathname.startsWith("/settings/model/")) {
    return director && pathname === `/settings/model/${encodeURIComponent(director.id)}`
      ? "director"
      : "models";
  }
  if (pathname === "/settings") return director ? "director" : "models";
  return null;
}

export function SettingsList({ wide }: { wide: boolean }) {
  const { t } = useTranslation();
  const { user } = useApp();
  const { theme, language } = usePrefs();
  const { pathname } = useLocation();
  const routes = useModelRoutes();
  const [appearance, setAppearance] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const list = routes.data ?? [];
  const director = list.find((r) => r.is_director) ?? null;
  const current = wide ? selectedItem(pathname, director) : null;
  const name = user?.display_name || user?.email || t("settings.account");
  return (
    <div className={styles.listBody}>
      {routes.error ? (
        <Notice
          icon="offline"
          message={describeError(routes.error)}
          actionLabel={t("common.retry")}
          onAction={() => void routes.refetch()}
        />
      ) : null}
      {director ? (
        <DirectorCard route={director} light={wide} selected={current === "director"} />
      ) : routes.data ? (
        <SetupCard hasModels={list.length > 0} />
      ) : null}

      <div className={styles.groupLabel}>{t("settings.groupConfig")}</div>
      <div className={styles.group}>
        <Row
          to="/settings/account"
          title={name}
          subtitle={user?.display_name ? user.email : undefined}
          selected={current === "account"}
          leading={<span className={styles.avatar}>{Array.from(name)[0] ?? "?"}</span>}
        />
        {routes.data && !director ? (
          <Row
            to="/settings/models"
            icon="director"
            title={t("settings.director")}
            subtitle={t("settings.notSet")}
            subtitleTone="warn"
          />
        ) : null}
        <Row
          to="/settings/models"
          icon="key"
          title={t("settings.models")}
          subtitle={t("settings.modelsSub")}
          selected={current === "models"}
          trailing={
            routes.data ? (
              list.length > 0 ? (
                <span className={styles.count}>{list.length}</span>
              ) : (
                <span className={styles.rowSub}>{t("settings.noneAdded")}</span>
              )
            ) : null
          }
        />
        <Row
          to="/settings/tools"
          icon="search"
          title={t("settings.tools")}
          subtitle={t("settings.toolsSub")}
          selected={current === "tools"}
        />
      </div>
      <div className={styles.groupLabel}>{t("settings.groupOther")}</div>
      <div className={styles.group}>
        <Row
          icon="moon"
          title={t("appearance.title")}
          onClick={() => setAppearance(true)}
          trailing={<span className={styles.rowSub}>{t(`appearance.${theme}`)}</span>}
        />
        <Row
          icon="language"
          title={t("language.title")}
          onClick={() => setLanguageOpen(true)}
          trailing={
            <span className={styles.rowSub}>
              {language === "system" ? t("language.system") : LANGUAGE_NAMES[language]}
            </span>
          }
        />
        <Row
          to="/dev/probe"
          icon="probe"
          title={t("settings.probe")}
          subtitle={t("settings.probeSub")}
          selected={current === "probe"}
        />
      </div>
      <p className={styles.footer}>
        v{CLIENT_VERSION} · {window.location.host}
      </p>
      {appearance ? <AppearanceDialog onClose={() => setAppearance(false)} /> : null}
      {languageOpen ? <LanguageDialog onClose={() => setLanguageOpen(false)} /> : null}
    </div>
  );
}
