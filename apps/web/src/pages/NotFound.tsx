/** 地址不对：一大格白底墨点，大号的 404、一句说明和回到存档的链接 */

import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Panel } from "../components/comic.tsx";
import { useDocumentTitle } from "../hooks/useDocumentTitle.ts";
import styles from "./pages.module.css";

export function NotFound() {
  const { t } = useTranslation();
  useDocumentTitle(t("notFound.title"));
  return (
    <div className={styles.page}>
      <Panel tone="dots" hot className={styles.notFound}>
        <span className={styles.code} aria-hidden="true">
          404
        </span>
        <h1 className={styles.display}>{t("notFound.heading")}</h1>
        <p className={styles.lead}>
          <Trans i18nKey="notFound.text" components={{ home: <Link to="/playthroughs" /> }} />
        </p>
      </Panel>
    </div>
  );
}
