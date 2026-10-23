/** 拖着文件进窗口时盖在内容区上的接收区：一大格蓝网点，虚线描边 */

import { useTranslation } from "react-i18next";

import { Icon } from "../components/Icon.tsx";
import styles from "./import.module.css";

export function DropZone() {
  const { t } = useTranslation();
  return (
    <div className={styles.dropZone} aria-hidden="true">
      <span className={styles.dropIcon}>
        <Icon name="import" size={32} />
      </span>
      <span className={styles.dropTitle}>{t("workbench.import.dropTitle")}</span>
      <span className={styles.dropText}>{t("workbench.import.dropFormats")}</span>
    </div>
  );
}
