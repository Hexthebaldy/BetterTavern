/** 还没做完的一级页：只有标题。故事、剧本、设置、阅读页在后面的提交里补上 */

import { useDocumentTitle } from "../hooks/useDocumentTitle.ts";
import styles from "./pages.module.css";

export function Pending({ title }: { title: string }) {
  useDocumentTitle(title);
  return (
    <div className={styles.page}>
      <h1 className={styles.display}>{title}</h1>
    </div>
  );
}
