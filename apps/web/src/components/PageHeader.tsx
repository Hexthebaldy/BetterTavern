/** 一级页的大标题（故事、剧本、设置）：32/40，右边是数量；再右边放页面自己的按钮 */

import type { ReactNode } from "react";

import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | null;
  children?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {count != null ? <span className={styles.count}>{count}</span> : null}
      <div className={styles.actions}>{children}</div>
    </header>
  );
}
