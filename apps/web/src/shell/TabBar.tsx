/** 窄于 900 的底部胶囊 Tab 栏（手机、平板中屏）：选中项是透明的玻璃框（glass.tsx），图标和文字横排、蓝色 */

import { Link, useLocation } from "react-router";

import { Icon } from "../components/Icon.tsx";
import { cx } from "../components/controls.tsx";
import { useGlass } from "./glass.tsx";
import { isActive, NAV_ITEMS } from "./nav.ts";
import styles from "./shell.module.css";

export function TabBar() {
  const { pathname } = useLocation();
  const { ref, glass } = useGlass(NAV_ITEMS.find((item) => isActive(item, pathname))?.to ?? null);
  return (
    <nav aria-label="主导航" className={styles.tabBar}>
      {glass}
      {NAV_ITEMS.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.to}
            ref={ref(item.to)}
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
