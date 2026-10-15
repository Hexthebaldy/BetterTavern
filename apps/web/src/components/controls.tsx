/**
 * 共用控件：按钮、图标按钮、输入框、提示条、胶囊、加载点。外观和状态与 App 的 primitives、controls、feedback 对应，
 * 悬停、按下、键盘焦点写在 controls.module.css 里，页面不再单独写。
 */

import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import { Icon, type IconName } from "./Icon.tsx";
import styles from "./controls.module.css";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function Dots({ label = "加载中" }: { label?: string }) {
  return (
    <span className={styles.dots} role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}

// ---- 按钮 -------------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "dangerSolid";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  /** 文字前的图标 */
  icon?: IconName;
  /** 文字后的图标；between 时放进右侧的半透明圆里 */
  trailingIcon?: IconName;
  /** 文字靠左、图标靠右（推进流程的主按钮） */
  between?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** 胶囊按钮：默认高 44，lg 52、sm 36。busy 时显示三个点，不响应点击 */
export function Button({
  label,
  variant = "primary",
  size = "md",
  busy,
  icon,
  trailingIcon,
  between,
  className,
  disabled,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  const arrow = between && trailingIcon;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        styles.button,
        styles[variant],
        size !== "md" && styles[size],
        between && styles.between,
        arrow && styles.withArrow,
        className,
      )}
      {...rest}
    >
      {busy ? (
        <Dots label={`${label}中`} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} /> : null}
          <span>{label}</span>
          {arrow ? (
            <span className={styles.arrow}>
              <Icon name={trailingIcon} size={18} />
            </span>
          ) : trailingIcon ? (
            <Icon name={trailingIcon} size={20} />
          ) : null}
        </>
      )}
    </button>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  /** 读屏和提示用的名字 */
  label: string;
  tone?: "grey" | "plain" | "card";
  /** 选中（墨色） */
  on?: boolean;
  diameter?: number;
  iconSize?: number;
  /** 右上角的蓝色小圆点 */
  badge?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** 圆形图标按钮：默认 40 的灰色圆；plain 透明底，card 白底加投影 */
export function IconButton({
  icon,
  label,
  tone = "grey",
  on,
  diameter,
  iconSize = 22,
  badge,
  className,
  style,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(styles.iconButton, tone !== "grey" && styles[tone], on && styles.on, className)}
      style={diameter ? { width: diameter, height: diameter, ...style } : style}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
      {badge ? <span className={styles.badge} /> : null}
    </button>
  );
}

// ---- 输入框 -----------------------------------------------------------------------------

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  /** 标签后面的“可选” */
  optional?: boolean;
  /** 在标签行右边显示“已输入 / 上限”（需要 maxLength） */
  counter?: boolean;
  hint?: string;
  error?: string | null;
  /** 输入框里右侧的按钮（显示密码） */
  trailing?: ReactNode;
  /** 输入框下面的额外一行（密码长度条） */
  below?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

/** 输入框：灰底无边，聚焦一圈 2px 蓝色内描边；出错时浅红底、红圈，下面一行红字 */
export function Field({
  label,
  optional,
  counter,
  hint,
  error,
  trailing,
  below,
  className,
  id,
  ref,
  ...input
}: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const length = typeof input.value === "string" ? input.value.length : 0;
  return (
    <div className={cx(styles.field, className)}>
      <div className={styles.labelRow}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {optional ? <span className={styles.optional}> 可选</span> : null}
        </label>
        {counter && input.maxLength ? (
          <span className={styles.count}>
            {length} / {input.maxLength}
          </span>
        ) : null}
      </div>
      <div className={styles.inputBox}>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={cx(styles.input, trailing ? styles.hasTrailing : null, error && styles.invalid)}
          {...input}
        />
        {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
      </div>
      {below}
      {error ? (
        <div id={messageId} className={styles.message}>
          <Icon name="alertCircle" size={15} />
          <span>{error}</span>
        </div>
      ) : hint ? (
        <div id={messageId} className={cx(styles.message, styles.hint)}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** 密码框：右侧的眼睛切换明文 */
export function PasswordField(props: Omit<FieldProps, "type" | "trailing">) {
  const [reveal, setReveal] = useState(false);
  return (
    <Field
      {...props}
      type={reveal ? "text" : "password"}
      trailing={
        <IconButton
          icon={reveal ? "eyeOff" : "eye"}
          label={reveal ? "隐藏密码" : "显示密码"}
          tone="plain"
          onClick={() => setReveal((r) => !r)}
        />
      }
    />
  );
}

// ---- 提示条与胶囊 -------------------------------------------------------------------------

export type Tone = "error" | "warn" | "info";

/** 提示条：圆角 20 的色卡；三角 = 错误 / 警告，圆圈 i = 信息。floating 时带投影 */
export function Notice({
  tone = "error",
  message,
  icon,
  actionLabel,
  onAction,
  onClose,
  floating,
  className,
}: {
  tone?: Tone;
  message: ReactNode;
  icon?: IconName;
  /** 右边一个同色的胶囊按钮（重新加载之类） */
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  floating?: boolean;
  className?: string;
}) {
  const action = actionLabel && onAction;
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cx(
        styles.notice,
        styles[`tone-${tone}`],
        floating && styles.floating,
        action && styles.withAction,
        className,
      )}
    >
      <Icon name={icon ?? (tone === "info" ? "info" : "alert")} size={20} />
      <div className={styles.noticeText}>{message}</div>
      {action ? (
        <button type="button" className={styles.noticeAction} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {onClose ? (
        <IconButton
          icon="close"
          label="关闭"
          iconSize={16}
          className={styles.noticeClose}
          onClick={onClose}
        />
      ) : null}
    </div>
  );
}

export type PillTone = "acc" | "warn" | "ok" | "err" | "grey";

/** 胶囊标签：状态、“我”、“导演”。dot 是前面的小圆点（“正在写下一段”） */
export function Pill({
  label,
  tone = "grey",
  icon,
  dot,
  className,
}: {
  label: ReactNode;
  tone?: PillTone;
  icon?: IconName;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cx(styles.pill, styles[`pill-${tone}`], (icon || dot) && styles.lead, className)}>
      {dot ? <span className={styles.pillDot} /> : null}
      {icon ? <Icon name={icon} size={13} strokeWidth={2.2} /> : null}
      {label}
    </span>
  );
}
