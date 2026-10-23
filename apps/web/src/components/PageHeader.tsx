/**
 * 一级页的页头（docs/design/comic 的“页面结构”）：一行，离窗口顶 36、高 48。左边是页标题（宋体 900，40/48）、
 * 数量（墨底小标签）和一句说明；右边是这一页的工具：搜索框、筛选、按钮（描边方块加硬投影，.sq）。
 */

import type { MouseEvent, ReactNode, SelectHTMLAttributes } from "react";

import { Keycap } from "./comic.tsx";
import { cx } from "./controls.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  count,
  sub,
  lead,
  children,
}: {
  title: ReactNode;
  count?: number | null;
  /** 标题后面的一句说明（“登场人物 · 角色卡仓库”） */
  sub?: ReactNode;
  /** 标题前面的标签（阅读页的回合数） */
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      {lead}
      <h1 className={styles.title}>{title}</h1>
      {count != null ? <span className={styles.count}>{count}</span> : null}
      {sub ? <span className={styles.sub}>{sub}</span> : null}
      <div className={styles.actions}>{children}</div>
    </header>
  );
}

/** 页头的搜索框：放大镜加输入框 */
export function HeaderSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className={cx(styles.tool, styles.search)}>
      <Icon name="search" size={18} strokeWidth={2.2} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
      />
    </label>
  );
}

/** 页头的工具按钮（描边方块）：连接测试、草稿、导入 */
export function HeaderTool({
  icon,
  label,
  kbd,
  onClick,
  active,
  className,
  ...rest
}: {
  icon: IconName;
  label: string;
  /** 文字后面的键帽（阅读页的“世界 W”） */
  kbd?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  className?: string;
  "aria-keyshortcuts"?: string;
  "aria-haspopup"?: "dialog" | "menu";
  "aria-expanded"?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(styles.tool, active && styles.toolOn, className)}
      onClick={onClick}
      {...rest}
    >
      <Icon name={icon} size={18} strokeWidth={2.2} />
      {label}
      {kbd ? <Keycap className={styles.toolKey}>{kbd}</Keycap> : null}
    </button>
  );
}

/** 页头的筛选（原生下拉框，套上描边方块的样子） */
export function HeaderSelect({
  icon = "list",
  className,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: IconName }) {
  return (
    <span className={cx(styles.tool, styles.select, className)}>
      <Icon name={icon} size={18} strokeWidth={2.2} />
      <select {...select} />
      <Icon name="chevronDown" size={16} strokeWidth={2.2} />
    </span>
  );
}
