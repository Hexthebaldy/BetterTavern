/** 连接测试和诊断日志（/dev/probe）：从设置页进来，左上角回到设置 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import pages from "../pages.module.css";
import { ProbeBody } from "./ProbeBody.tsx";
import styles from "./probe.module.css";

export function ProbePage() {
  const { t } = useTranslation();
  return (
    <div className={cx(pages.page, styles.page)}>
      <Link to="/settings" className={styles.back}>
        <Icon name="back" size={18} />
        {t("nav.settings")}
      </Link>
      <div className={styles.body}>
        <ProbeBody />
      </div>
    </div>
  );
}
