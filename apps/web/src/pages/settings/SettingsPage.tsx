/**
 * 设置（/settings，从侧栏最下面的账户小窗进来）：一页分组摆出来，不再是“左边列表、右边详情”。
 * 模型和外部服务已经是侧栏里单独的模块，账户（修改密码、退出、删除）在账户小窗里。这里只剩：
 * - 外观、语言：选项直接摆在页面上，点一下立刻生效；
 * - 快捷键：单键快捷键的开关，和“查看全部快捷键”；
 * - 连接测试和诊断日志：在单独的一页（/dev/probe）；
 * - 版本号和服务器地址。
 * 宽屏时外观和语言左右并排。
 */

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { Button, cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { CLIENT_VERSION } from "../../config.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import pages from "../pages.module.css";
import { LanguageOptions, ThemeOptions } from "./Appearance.tsx";
import styles from "./settingsPage.module.css";

export function SettingsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.settings"));
  const navigate = useNavigate();
  const { singleKeys, setSingleKeys } = usePrefs();
  return (
    <div className={cx(pages.page, styles.page)}>
      <PageHeader title={t("nav.settings")} />
      <div className={styles.pair}>
        <section className={styles.section} aria-labelledby="settings-appearance">
          <h2 id="settings-appearance" className={styles.heading}>
            {t("appearance.title")}
          </h2>
          <ThemeOptions />
        </section>
        <section className={styles.section} aria-labelledby="settings-language">
          <h2 id="settings-language" className={styles.heading}>
            {t("language.title")}
          </h2>
          <LanguageOptions />
        </section>
      </div>

      <section className={styles.section} aria-labelledby="settings-shortcuts">
        <h2 id="settings-shortcuts" className={styles.heading}>
          {t("shortcuts.title")}
        </h2>
        <div className={styles.card}>
          <label className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{t("shortcuts.single")}</span>
              <span className={styles.rowSub}>{t("shortcuts.singleNote")}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className={styles.toggle}
              checked={singleKeys}
              onChange={(e) => setSingleKeys(e.target.checked)}
            />
          </label>
          <div className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{t("settings.allShortcuts")}</span>
            </span>
            <Button
              label={t("settings.showShortcuts")}
              variant="secondary"
              size="sm"
              onClick={() => window.dispatchEvent(new Event("bt:shortcuts"))}
            />
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="settings-probe">
        <h2 id="settings-probe" className={styles.heading}>
          {t("settings.probe")}
        </h2>
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.rowIcon}>
              <Icon name="probe" size={20} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{t("settings.probeDiagnostics")}</span>
              <span className={styles.rowSub}>{t("settings.probeSub")}</span>
            </span>
            <Button
              label={t("settings.openProbe")}
              variant="secondary"
              size="sm"
              onClick={() => navigate("/dev/probe")}
            />
          </div>
        </div>
      </section>

      <p className={styles.footer}>
        v{CLIENT_VERSION} · {window.location.host}
      </p>
    </div>
  );
}
