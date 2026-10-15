/** 分段控件：凹进去的灰色轨道，选中项是浮起的白色胶囊（工作窗口上限、上下文窗口、测试时长） */

import { cx } from "../../components/controls.tsx";
import styles from "./settings.module.css";

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  mono,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          className={cx(styles.segment, value === o.value && styles.segmentOn, mono && styles.mono)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
