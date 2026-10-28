/**
 * 设置（/settings，docs/design/comic 的 08）：漫画格子，不翻页，各占一格：
 * - 账户：头像（名字的第一个字压在蓝网点上）、昵称、邮箱、注册时间、存档 / 剧本 / 模型的数量，修改密码、退出登录、删除账户，
 *   以及三份条款（宽屏没有账户小窗了，都搬到这里）；
 * - 外观：跟随系统 / 浅色 / 夜间，每项带一个小预览；语言；
 * - 阅读：正文字号（A− / A+，点中间的数字回到跟随浏览器）、正文字体，下面一段样字（阅读页里也能改，存在同一份偏好里）；
 * - 键盘快捷键：几个常用的键，单键快捷键的开关，“全部 →”打开快捷键一览；
 * - 外部服务：网页搜索、读网页、生成封面三项现在用什么，“管理 →”进 /settings/tools；
 * - 人设（第四行，占满一行）：人设库里的人设，默认人设排第一，点一个进 /settings/personas 编辑；“管理 →”也进那里；
 * - 连接测试和诊断日志：进 /dev/probe。
 * 版本号和服务器地址写在连接测试那一格的左下角。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import {
  LANGUAGE_NAMES,
  LANGUAGE_TAGS,
  LANGUAGES,
  type LanguageSetting,
} from "@bettertavern/core/i18n/index";
import { readingSize, stepSize, type ReadingFont } from "@bettertavern/core/play/reading";
import { initialOfName } from "@bettertavern/core/scenario/persona";
import { formatDate } from "@bettertavern/core/utils/format";
import type { ThemeSetting } from "@bettertavern/design/themes";

import { Caption, Keycap, Panel, Portrait } from "../../components/comic.tsx";
import { ComicGrid } from "../../components/ComicGrid.tsx";
import { Button, cx, Pill, Segmented, Toggle } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { CLIENT_VERSION } from "../../config.ts";
import { useModelRoutes } from "../../data/models.ts";
import { usePersonas } from "../../data/personas.ts";
import { useScenarios } from "../../data/scenarios.ts";
import { useStories } from "../../data/stories.ts";
import { useToolRoutes } from "../../data/tools.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { ChangePasswordDialog, DeleteAccountDialog } from "../../shell/AccountDialogs.tsx";
import { initialOf } from "../../shell/Avatar.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { useSystemLanguage } from "../../state/language.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import pages from "../pages.module.css";
import styles from "./settingsPage.module.css";

export function SettingsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.settings"));
  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.settings")} sub={t("settings.sub")} />
      <ComicGrid paged={false}>
        <AccountCell />
        <AppearanceCell />
        <LanguageCell />
        <ReadingCell />
        <ShortcutsCell />
        <ToolsCell />
        <ProbeCell />
        <PersonasCell />
      </ComicGrid>
    </div>
  );
}

function CellLabel({ children, link }: { children: string; link?: { to: string; label: string } }) {
  return (
    <div className={styles.cellHead}>
      <h2 className={styles.label}>{children}</h2>
      {link ? (
        <Link to={link.to} className={styles.headLink}>
          {link.label} →
        </Link>
      ) : null}
    </div>
  );
}

function AccountCell() {
  const { t } = useTranslation();
  const { user, signOut } = useApp();
  const stories = useStories();
  const scenarios = useScenarios();
  const routes = useModelRoutes();
  const [dialog, setDialog] = useState<"password" | "delete" | null>(null);
  if (!user) return null;
  const counts: [string, number | undefined][] = [
    [t("account.saves"), stories.data?.length],
    [t("account.scenarios"), scenarios.data?.length],
    [t("account.models"), routes.data?.length],
  ];
  return (
    <Panel hot className={styles.account} style={{ gridColumn: "1 / span 2", gridRow: "1 / span 2" }}>
      <CellLabel>{t("nav.account")}</CellLabel>
      <Portrait name={user.display_name || user.email} glyph={initialOf(user)} seed={user.id} tone="blue" size={112} radius={56} className={styles.avatar} />
      <span className={styles.nickname}>{user.display_name || t("nav.noNickname")}</span>
      <span className={styles.accountLines}>
        <span className={styles.email}>{user.email}</span>
        <span>{t("account.joined", { date: formatDate(user.created_at) })}</span>
      </span>
      <span className={styles.counts}>
        {counts.map(([label, value]) =>
          value === undefined ? null : <Pill key={label} tone="card" label={`${label} ${value}`} />,
        )}
      </span>
      <span className={styles.accountButtons}>
        <Button label={t("account.changePassword")} icon="lock" variant="secondary" size="sm" onClick={() => setDialog("password")} />
        <Button label={t("account.signOut")} icon="logout" variant="secondary" size="sm" onClick={() => void signOut()} />
      </span>
      <span className={styles.accountFoot}>
        <button type="button" className={styles.deleteAccount} onClick={() => setDialog("delete")}>
          <Icon name="trash" size={15} />
          {t("account.deleteAccount")}
        </button>
        <nav className={styles.legal} aria-label={t("legal.nav")}>
          <Link to="/terms">{t("legal.terms")}</Link>
          <Link to="/privacy">{t("legal.privacy")}</Link>
          <Link to="/rules">{t("legal.rules")}</Link>
        </nav>
      </span>
      {dialog === "password" ? <ChangePasswordDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <DeleteAccountDialog onClose={() => setDialog(null)} /> : null}
    </Panel>
  );
}

/** 外观的小预览：一块纸色或墨色的格子，一个样字和三行字的条；跟随系统是左右两半 */
function Preview({ parts }: { parts: ("light" | "dark")[] }) {
  const { t } = useTranslation();
  return (
    <span className={styles.preview} aria-hidden="true">
      {parts.map((part, i) => (
        <span key={i} className={cx(styles.previewPart, part === "dark" && styles.previewDark)}>
          <b>{t("settings.previewWord")}</b>
          <i style={{ width: "90%" }} />
          <i style={{ width: "72%" }} />
          <i style={{ width: "84%" }} />
        </span>
      ))}
    </span>
  );
}

function AppearanceCell() {
  const { t } = useTranslation();
  const { theme, setTheme } = usePrefs();
  const options: { value: ThemeSetting; parts: ("light" | "dark")[] }[] = [
    { value: "system", parts: ["light", "dark"] },
    { value: "light", parts: ["light"] },
    { value: "night", parts: ["dark"] },
  ];
  return (
    <Panel className={styles.appearance} style={{ gridColumn: "3 / span 4", gridRow: "1" }}>
      <CellLabel>{t("appearance.title")}</CellLabel>
      <div className={styles.themes} role="radiogroup" aria-label={t("appearance.title")}>
        {options.map((option) => {
          const on = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx(styles.theme, on && styles.themeOn)}
              onClick={() => setTheme(option.value)}
            >
              <Preview parts={option.parts} />
              <span className={styles.optionName}>
                <span className={cx(styles.radio, on && styles.radioOn)} />
                {t(`appearance.${option.value}`)}
              </span>
              <span className={styles.optionNote}>{t(`appearance.${option.value}Note`)}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function LanguageCell() {
  const { t } = useTranslation();
  const { language, setLanguage } = usePrefs();
  const system = useSystemLanguage();
  const options: { value: LanguageSetting; label: string; note?: string }[] = [
    { value: "system", label: t("language.system"), note: t("language.systemNote", { language: LANGUAGE_NAMES[system] }) },
    ...LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] })),
  ];
  return (
    <Panel className={styles.language} style={{ gridColumn: "3 / span 2", gridRow: "2" }}>
      <CellLabel>{t("language.title")}</CellLabel>
      <div className={styles.languages} role="radiogroup" aria-label={t("language.title")}>
        {options.map((option) => {
          const on = language === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              lang={option.value === "system" ? undefined : LANGUAGE_TAGS[option.value]}
              className={cx(styles.languageRow, on && styles.languageOn)}
              onClick={() => setLanguage(option.value)}
            >
              <span className={cx(styles.radio, on && styles.radioOn)} />
              {option.label}
              {option.note ? <span className={styles.languageNote}>{option.note}</span> : null}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function ReadingCell() {
  const { t } = useTranslation();
  const { reading, setReading } = usePrefs();
  const size = readingSize(reading);
  return (
    <Panel className={styles.reading} style={{ gridColumn: "5 / span 2", gridRow: "2" }}>
      <CellLabel>{t("settings.reading")}</CellLabel>
      <div className={styles.readingRow}>
        <span className={styles.readingName}>{t("reading.size")}</span>
        <span className={styles.stepper}>
          <button type="button" aria-label={t("reading.smaller")} onClick={() => setReading({ ...reading, size: stepSize(reading, -1) })}>
            A−
          </button>
          <button
            type="button"
            className={styles.stepperValue}
            aria-label={reading.size === null ? t("reading.followBrowserSize") : t("reading.fixedSize")}
            data-tip={reading.size === null ? t("reading.followBrowserSize") : t("settings.resetSize")}
            onClick={() => setReading({ ...reading, size: null })}
          >
            {size}
          </button>
          <button type="button" aria-label={t("reading.larger")} onClick={() => setReading({ ...reading, size: stepSize(reading, 1) })}>
            A+
          </button>
        </span>
      </div>
      <div className={styles.readingRow}>
        <span className={styles.readingName}>{t("reading.font")}</span>
        <Segmented<ReadingFont>
          label={t("reading.font")}
          value={reading.font}
          options={[
            { value: "serif", label: t("reading.serif") },
            { value: "sans", label: t("reading.sans") },
          ]}
          onChange={(font) => setReading({ ...reading, font })}
          className={styles.fontSwitch}
        />
      </div>
      <Caption className={cx(styles.sample, reading.font === "sans" && styles.sampleSans)}>
        <span style={{ fontSize: Math.min(size, 19) }}>{t("settings.readingSample")}</span>
      </Caption>
    </Panel>
  );
}

function ShortcutsCell() {
  const { t } = useTranslation();
  const { singleKeys, setSingleKeys } = usePrefs();
  const keys: { keys: string[]; label: string }[] = [
    { keys: ["Q"], label: t("shortcuts.items.wheel") },
    { keys: ["1", "6"], label: t("shortcuts.items.wheelJump") },
    { keys: ["N"], label: t("settings.keyNewStory") },
    { keys: ["/"], label: t("shortcuts.items.write") },
    { keys: ["?"], label: t("shortcuts.items.help") },
    { keys: ["Esc"], label: t("settings.keyClose") },
  ];
  return (
    <Panel className={styles.shortcuts} style={{ gridColumn: "1 / span 2", gridRow: "3" }}>
      <div className={styles.cellHead}>
        <h2 className={styles.label}>{t("shortcuts.title")}</h2>
        <button type="button" className={styles.headLink} onClick={() => window.dispatchEvent(new Event("bt:shortcuts"))}>
          {t("settings.allLink")} →
        </button>
      </div>
      <div className={styles.keys}>
        {keys.map((item) => (
          <span key={item.label} className={styles.key}>
            {item.keys.map((key, i) => (
              <span key={key} className={styles.keyPart}>
                {i > 0 ? "–" : null}
                <Keycap>{key}</Keycap>
              </span>
            ))}
            {item.label}
          </span>
        ))}
      </div>
      <label className={styles.single}>
        <span>{t("shortcuts.single")}</span>
        <Toggle checked={singleKeys} onChange={setSingleKeys} aria-label={t("shortcuts.single")} />
      </label>
    </Panel>
  );
}

function ToolsCell() {
  const { t } = useTranslation();
  const routes = useToolRoutes();
  const pick = (kind: "search" | "fetch" | "image") =>
    (routes.data ?? []).find((r) => r.kind === kind && r.is_default) ?? (routes.data ?? []).find((r) => r.kind === kind);
  const name = (route: ReturnType<typeof pick>): string =>
    route ? route.label || t(`tools.providers.${route.provider as "tavily"}`, { defaultValue: route.provider }) : "";
  const rows = (["search", "fetch", "image"] as const).map((kind) => {
    const route = pick(kind);
    const ok = route?.status === "ok";
    const value = route
      ? `${name(route)}${route.is_default ? ` · ${t("tools.default")}` : ""}`
      : kind === "search"
        ? t("settings.toolSearchFree")
        : kind === "fetch"
          ? t("settings.toolFetchServer")
          : t("settings.toolNone");
    const end = route ? (
      ok ? (
        <span className={styles.okChip}>
          <Icon name="check" size={14} strokeWidth={2.6} />
          {t("settings.toolOk")}
        </span>
      ) : (
        <span className={styles.toolMuted}>{t("tools.untested")}</span>
      )
    ) : kind === "image" ? (
      <Link to="/settings/tools" className={styles.toolAdd}>
        {t("common.add")}
      </Link>
    ) : (
      <span className={styles.toolMuted}>{t("settings.toolNoSetup")}</span>
    );
    return { kind, value, end, muted: !route && kind === "image" };
  });
  return (
    <Panel className={styles.tools} style={{ gridColumn: "3 / span 2", gridRow: "3" }}>
      <CellLabel link={{ to: "/settings/tools", label: t("settings.manage") }}>{t("nav.tools")}</CellLabel>
      <span className={styles.toolsNote}>{t("settings.toolsNote")}</span>
      {rows.map((row) => (
        <div key={row.kind} className={styles.toolRow}>
          <b>{t(`tools.kinds.${row.kind}`)}</b>
          <span className={cx(styles.toolValue, row.muted && styles.toolMuted)}>{row.value}</span>
          {row.end}
        </div>
      ))}
    </Panel>
  );
}

function PersonasCell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const personas = usePersonas();
  const list = personas.data ?? [];
  const open = (id: string): void => void navigate(`/settings/personas?id=${encodeURIComponent(id)}`);
  return (
    <Panel className={styles.personas} style={{ gridColumn: "1 / span 6", gridRow: "4" }}>
      <CellLabel link={{ to: "/settings/personas", label: t("settings.manage") }}>{t("personas.title")}</CellLabel>
      <span className={styles.toolsNote}>
        {list.length ? t("personas.count", { count: list.length }) : t("personas.noneHint")}
      </span>
      <div className={styles.personaList}>
        {list.map((persona) => (
          <button key={persona.id} type="button" className={styles.personaTile} onClick={() => open(persona.id)}>
            <Portrait
              name={persona.name}
              seed={persona.id}
              glyph={initialOfName(persona.name)}
              blobId={persona.avatar_blob_id}
              size={44}
              radius={22}
            />
            <span className={styles.personaName}>{persona.name}</span>
            {persona.is_default ? <Pill tone="acc" label={t("personas.defaultBadge")} /> : null}
          </button>
        ))}
        <button type="button" className={cx(styles.personaTile, styles.personaAdd)} onClick={() => open("new")}>
          <Icon name="plus" size={20} strokeWidth={2.2} />
          <span className={styles.personaName}>{t("personas.add")}</span>
        </button>
      </div>
    </Panel>
  );
}

function ProbeCell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Panel tone="ink" className={styles.probe} style={{ gridColumn: "5 / span 2", gridRow: "3" }}>
      <span className={styles.probeLabel}>{t("settings.probeDiagnostics")}</span>
      <span className={styles.probeTitle}>{t("settings.probeSub")}</span>
      <span className={styles.probeFoot}>
        <span className={styles.version}>
          v{CLIENT_VERSION} · {window.location.host}
        </span>
        <Button label={t("settings.openProbe")} variant="blue" size="sm" onClick={() => navigate("/dev/probe")} />
      </span>
    </Panel>
  );
}
