/** 窄于 900 的底部胶囊 Tab 栏（手机、平板中屏）：选中项是墨色小胶囊，图标和文字横排 */

import { Link, useLocation } from "react-router";

import { Icon } from "../components/Icon.tsx";
import { cx } from "../components/controls.tsx";
import { isActive, NAV_ITEMS } from "./nav.ts";
import styles from "./shell.module.css";

export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="主导航" className={styles.tabBar}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cx(styles.tab, active && styles.tabOn)}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
