/**
 * 共用控件：按钮、图标按钮、输入框、开关、提示条、胶囊、加载点。外观和状态与 App 的 primitives、controls、feedback 对应，
 * 悬停、按下、键盘焦点写在 controls.module.css 里，页面不再单独写。
 */

import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "./Icon.tsx";
import styles from "./controls.module.css";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function Dots({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <span className={styles.dots} role="status" aria-label={label ?? t("common.loading")}>
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
  const { t } = useTranslation();
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
        <Dots label={t("common.busy", { label })} />
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
  /** 悬停或键盘焦点时的提示；默认就是 label，传 false 不要提示 */
  tip?: string | false;
  ref?: Ref<HTMLButtonElement>;
};

/** 圆形图标按钮：默认 40 的灰色圆；plain 透明底，card 白底加投影。悬停 500ms 出提示，有快捷键时带键帽 */
export function IconButton({
  icon,
  label,
  tone = "grey",
  on,
  diameter,
  iconSize = 22,
  badge,
  tip,
  className,
  style,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  const kbd = rest["aria-keyshortcuts"];
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-tip={tip === false ? undefined : (tip ?? label)}
      data-kbd={kbd === "Escape" ? "Esc" : kbd}
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
  const { t } = useTranslation();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const length = typeof input.value === "string" ? input.value.length : 0;
  return (
    <div className={cx(styles.field, className)}>
      <div className={styles.labelRow}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {optional ? <span className={styles.optional}> {t("common.optional")}</span> : null}
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
  const { t } = useTranslation();
  return (
    <Field
      {...props}
      type={reveal ? "text" : "password"}
      trailing={
        <IconButton
          icon={reveal ? "eyeOff" : "eye"}
          label={reveal ? t("auth.hidePassword") : t("auth.showPassword")}
          tone="plain"
          onClick={() => setReveal((r) => !r)}
        />
      }
    />
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  /** 标签只给读屏用，不显示 */
  hideLabel?: boolean;
  /** 标签后面的“可选” */
  optional?: boolean;
  /** 右下角显示“已输入 / 上限”（需要 maxLength） */
  counter?: boolean;
  hint?: string;
  error?: string | null;
  height?: number;
  ref?: Ref<HTMLTextAreaElement>;
};

/** 多行输入框：同输入框的外观，右下角可以带字数 */
export function TextArea({
  label,
  hideLabel,
  optional,
  counter,
  hint,
  error,
  height = 100,
  className,
  id,
  ref,
  ...input
}: TextAreaProps) {
  const autoId = useId();
  const { t } = useTranslation();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const length = typeof input.value === "string" ? input.value.length : 0;
  return (
    <div className={cx(styles.field, className)}>
      {hideLabel ? null : (
        <div className={styles.labelRow}>
          <label htmlFor={inputId} className={styles.label}>
            {label}
            {optional ? <span className={styles.optional}> {t("common.optional")}</span> : null}
          </label>
        </div>
      )}
      <div className={styles.inputBox}>
        <textarea
          ref={ref}
          id={inputId}
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={cx(styles.input, styles.textarea, error && styles.invalid)}
          style={{ height }}
          {...input}
        />
        {counter && input.maxLength ? (
          <span className={cx(styles.count, styles.innerCount)}>
            {length} / {input.maxLength}
          </span>
        ) : null}
      </div>
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

/** 开关：52×32 的胶囊，打开是强调色。外面包一个 label 写文字，点文字也能切换 */
export function Toggle({
  checked,
  onChange,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className={cx(styles.toggle, className)}
      {...rest}
    />
  );
}

// ---- 标签、勾选 -----------------------------------------------------------------------------

/** 胶囊标签：可点的选项（名字建议、文风）。选中是墨色底；check 时是多选，前面带一个勾 */
export function Chip({
  label,
  selected = false,
  onClick,
  check,
  icon,
  accent,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  check?: boolean;
  icon?: IconName;
  /** “+ 自定义”这类入口，用蓝字 */
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      role={check ? "checkbox" : undefined}
      aria-checked={check ? selected : undefined}
      aria-pressed={check ? undefined : selected}
      className={cx(styles.chip, selected && styles.chipOn, accent && styles.chipAccent)}
      onClick={onClick}
    >
      {selected && check ? <Icon name="check" size={14} strokeWidth={2.4} /> : null}
      {icon ? <Icon name={icon} size={15} /> : null}
      {label}
    </button>
  );
}

/** 22 的圆角勾选框加文字；plus 是“其他…”入口（浅蓝底的加号） */
export function Checkbox({
  label,
  checked,
  onToggle,
  plus,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  plus?: boolean;
}) {
  return (
    <button
      type="button"
      role={plus ? undefined : "checkbox"}
      aria-checked={plus ? undefined : checked}
      className={cx(styles.checkRow, plus && styles.checkPlus)}
      onClick={onToggle}
    >
      <span className={cx(styles.box, checked && styles.boxOn, plus && styles.boxPlus)}>
        {checked ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
        {plus ? <Icon name="plus" size={14} strokeWidth={2.2} /> : null}
      </span>
      <span>{label}</span>
    </button>
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
  const { t } = useTranslation();
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
          label={t("common.close")}
          iconSize={16}
          className={styles.noticeClose}
          onClick={onClose}
        />
      ) : null}
    </div>
  );
}

/** card：灰卡上的白底胶囊（灰底的 grey 在灰卡上看不见） */
export type PillTone = "acc" | "warn" | "ok" | "err" | "grey" | "card";

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
