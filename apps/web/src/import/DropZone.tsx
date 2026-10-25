/** 拖着文件进窗口时盖在内容区上的接收区：一大格蓝网点，虚线描边。世界书一页接的是世界书，其余页面接角色卡 */

import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";

import { Icon } from "../components/Icon.tsx";
import styles from "./import.module.css";

export function DropZone() {
  const { t } = useTranslation();
  const lorebooks = useLocation().pathname === "/lorebooks";
  return (
    <div className={styles.dropZone} aria-hidden="true">
      <span className={styles.dropIcon}>
        <Icon name="import" size={32} />
      </span>
      <span className={styles.dropTitle}>{lorebooks ? t("lorebook.dropHere") : t("workbench.import.dropTitle")}</span>
      <span className={styles.dropText}>{lorebooks ? t("lorebook.notJsonMessage") : t("workbench.import.dropFormats")}</span>
    </div>
  );
}
