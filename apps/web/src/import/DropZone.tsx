/** 拖着文件进窗口时盖在内容区上的接收区（W04）：浅蓝底、2px 蓝色内描边、圆角 32 */

import { useTranslation } from "react-i18next";

import { Icon } from "../components/Icon.tsx";
import styles from "./import.module.css";

export function DropZone() {
  const { t } = useTranslation();
  return (
    <div className={styles.dropZone} aria-hidden="true">
      <span className={styles.dropIcon}>
        <Icon name="share" size={32} />
      </span>
      <span className={styles.dropTitle}>{t("import.dropTitle")}</span>
      <span className={styles.dropText}>
        {t("import.dropFormats")}
        <br />
        {t("import.dropSupports")}
      </span>
    </div>
  );
}
