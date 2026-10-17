/** 地址不对 */

import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useDocumentTitle } from "../hooks/useDocumentTitle.ts";
import styles from "./pages.module.css";

export function NotFound() {
  const { t } = useTranslation();
  useDocumentTitle(t("notFound.title"));
  return (
    <div className={styles.page}>
      <h1 className={styles.display}>{t("notFound.heading")}</h1>
      <p className={styles.lead}>
        <Trans i18nKey="notFound.text" components={{ link: <Link to="/playthroughs" /> }} />
      </p>
    </div>
  );
}
