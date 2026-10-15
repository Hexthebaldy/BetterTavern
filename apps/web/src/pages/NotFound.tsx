/** 地址不对 */

import { Link } from "react-router";

import { useDocumentTitle } from "../hooks/useDocumentTitle.ts";
import styles from "./pages.module.css";

export function NotFound() {
  useDocumentTitle("找不到页面");
  return (
    <div className={styles.page}>
      <h1 className={styles.display}>找不到这个页面</h1>
      <p className={styles.lead}>
        地址可能写错了，或者内容已经删掉。<Link to="/playthroughs">回到故事</Link>
      </p>
    </div>
  );
}
