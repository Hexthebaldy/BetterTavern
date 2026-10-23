/**
 * 窄于 900 的底部胶囊 Tab 栏（手机、平板中屏）：存档、剧本、角色、工作台，最后一项“更多”弹出账户小窗
 * （里面还有模型、外部服务、设置）。选中项是墨底，图标和文字横排。
 */

import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { Icon } from "../components/Icon.tsx";
import { cx } from "../components/controls.tsx";
import { useAccountMenu } from "./AccountMenu.tsx";
import { isActive, NAV_ITEMS } from "./nav.ts";
import styles from "./shell.module.css";

const TABS = NAV_ITEMS.filter((item) => item.tab);
const MORE = ["/models", "/settings", "/dev"];

export function TabBar() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const account = useAccountMenu({ connect: true });
  const moreOn = MORE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <nav aria-label={t("nav.main")} className={styles.tabBar}>
      {TABS.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cx(styles.tab, active && styles.tabOn)}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} size={22} />
            <span>{t(`nav.${item.name}`)}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className={cx(styles.tab, moreOn && styles.tabOn)}
        aria-haspopup="dialog"
        aria-expanded={account.isOpen}
        onClick={(event) => account.open(event.currentTarget)}
      >
        <Icon name="more" size={22} />
        <span>{t("nav.more")}</span>
      </button>
      {account.element}
    </nav>
  );
}
