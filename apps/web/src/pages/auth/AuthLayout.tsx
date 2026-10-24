/**
 * 登录、注册、验证邮箱、找回密码的版式（docs/design/comic 的“登录页”一节，png/10–12）：
 * - ≥ 900：两格漫画。左格是写故事的桌面（Desk，没有字，aria-hidden），右格是表单：白底、2.5 描边、圆角 10、--x8 投影，
 *   底是一圈很淡的集中线（FormRays）；表单宽 400，在右格里水平、垂直都居中。两格四周离窗口 40、中间空 16，宽度按 700 : 644 分，
 *   右格至少 480；窗口太矮时整页滚动。
 * - < 900：不显示左格，只留表单（Logo 和介绍在表单上面），同以前的窄屏。
 * 右格底部一行：左边是服务器行（ServerSwitch，只在登录、注册页，官方网站上不显示），右边是三份条款的链接。
 * 网页和接口同源，不能像 App 那样只换服务器地址；服务器行是跳到另一台服务器自己的网页。
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Logo } from "../../components/Logo.tsx";
import styles from "./auth.module.css";
import { Desk, FormRays } from "./Desk.tsx";
import type { DeskStage } from "./DeskSheets.tsx";
import { ServerSwitch } from "./ServerSwitch.tsx";

export function AuthLayout({
  desk = "full",
  server = false,
  children,
}: {
  /** 左格桌面的样子：注册页是“刚开始” */
  desk?: DeskStage;
  /** 底部要不要服务器行（登录、注册页） */
  server?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <div className={styles.deskPanel} aria-hidden="true">
        <Desk stage={desk} />
      </div>
      <div className={styles.formPanel}>
        <FormRays />
        <div className={styles.column}>{children}</div>
        <div className={styles.foot}>
          {server ? <ServerSwitch /> : null}
          <nav className={styles.legal} aria-label={t("legal.nav")}>
            <a href="/terms" target="_blank" rel="noopener">
              {t("legal.terms")}
            </a>
            <a href="/privacy" target="_blank" rel="noopener">
              {t("legal.privacy")}
            </a>
            <a href="/rules" target="_blank" rel="noopener">
              {t("legal.rules")}
            </a>
          </nav>
        </div>
      </div>
    </div>
  );
}

/** 表单最上面：Logo 和名字（宽屏）；窄屏是大一号的 Logo，登录页再加一句介绍 */
export function AuthBrand({ lead }: { lead?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.brand}>
        <Logo size={32} label={null} />
        <span>BetterTavern</span>
      </div>
      <div className={styles.narrowIntro}>
        <Logo size={48} />
        {lead ? <p className={styles.lead}>{t("auth.tagline")}</p> : null}
      </div>
    </>
  );
}

/** 宋体大标题，下面可以跟一个小块（验证页的邮箱）或一段说明 */
export function AuthTitle({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <div className={styles.heading}>
      <h1 className={styles.big}>{children}</h1>
      {below}
    </div>
  );
}

/** 验证码发到的邮箱：灰底小块，前面一把锁 */
export function EmailChip({ email }: { email: string }) {
  return (
    <span className={styles.emailChip}>
      <Icon name="lock" size={14} strokeWidth={2.2} />
      {email}
    </span>
  );
}

export const CODE_LENGTH = 6;

/**
 * 验证码：画成 6 个格子（填了的白底带投影，正在填的蓝框，没填的灰底），底下是一个真的输入框盖在格子上，
 * 所以粘贴、手机自动填验证码、读屏都照常；输入框本身透明，光标总在最后。
 * 不限输入框的长度：粘贴“123 456”这种带空格的，先去掉不是数字的，再留前 6 位。
 */
export function CodeField({
  value,
  onChange,
  aside,
  autoFocus,
}: {
  value: string;
  onChange: (code: string) => void;
  /** 标签行右边的小字（“15 分钟内有效”） */
  aside?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [focused, setFocused] = useState(false);
  const current = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <div className={styles.codeField}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {t("auth.code")}
        </label>
        {aside ? <span className={styles.note}>{aside}</span> : null}
      </div>
      <div className={styles.codeBoxes}>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const digit = value[i];
          const on = focused && i === current && value.length < CODE_LENGTH;
          return (
            <span
              key={i}
              aria-hidden="true"
              className={cx(styles.codeBox, digit ? styles.codeFilled : styles.codeEmpty, on && styles.codeOn)}
            >
              {digit ?? (on ? <i className={styles.caret} /> : null)}
            </span>
          );
        })}
        <input
          id={id}
          className={styles.codeInput}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSelect={(e) => {
            const end = e.currentTarget.value.length;
            if (e.currentTarget.selectionStart !== end) e.currentTarget.setSelectionRange(end, end);
          }}
        />
      </div>
    </div>
  );
}

/** 勾选框加一段带链接的文字（“已满 18 岁并同意…”）：勾选框是原生的 checkbox，文字里的链接可以单独点 */
export function AgreeRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.agree}>
      <input type="checkbox" className={styles.agreeInput} checked={checked} onChange={onToggle} />
      <span className={styles.agreeBox} aria-hidden="true">
        {checked ? <Icon name="check" size={14} strokeWidth={3} /> : null}
      </span>
      <span className={styles.agreeText}>{children}</span>
    </label>
  );
}

/** 重新发送验证码的倒计时：start() 以后 seconds 从 60 往下数，到 0 才能再发 */
export function useCooldown(initial = 0): { seconds: number; start: () => void } {
  const [seconds, setSeconds] = useState(initial);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return { seconds, start: () => setSeconds(60) };
}
