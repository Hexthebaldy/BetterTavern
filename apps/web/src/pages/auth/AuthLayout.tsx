/**
 * 登录、注册的版式（W01、W02，同平板宽屏 T01）：
 * - ≥ 900：左右分栏。左侧插画区宽 47.3%，离窗口 16，圆角 32，灰底，有 Logo、插画和一句介绍；右侧表单宽 400，在右半边居中。
 * - 600–899：表单宽 440 居中；< 600：整宽。窄屏的 Logo 和介绍在表单上面。
 * 网页和接口同源，没有 App 底部的“服务器”入口。
 */

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon.tsx";
import { Logo } from "../../components/Logo.tsx";
import styles from "./auth.module.css";

const WAVE = "q30-14 60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0t60 0";

/** 插画：船、灯、太阳和水波，线条用墨色，浅一档的用 line2（和 App 的 AuthLayout 相同） */
function Art() {
  const ink = {
    fill: "none",
    stroke: "var(--ink)",
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  const soft = { ...ink, stroke: "var(--line2)" };
  return (
    <svg className={styles.art} viewBox="0 0 565 802" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx={402} cy={236} r={30} fill="var(--acc)" />
      <circle cx={402} cy={236} r={58} fill="none" stroke="var(--line2)" strokeWidth={1.5} />
      <circle
        cx={402}
        cy={236}
        r={92}
        fill="none"
        stroke="var(--line2)"
        strokeWidth={1.5}
        strokeDasharray="2 7"
      />
      <path d="M60 330h120M60 346h76" {...soft} />
      <path d="M150 556h196l-24 30H174z" {...ink} />
      <path d="M190 556q58-58 116 0" {...ink} />
      <path d="M248 498v-50" {...ink} />
      <circle cx={248} cy={440} r={8} fill="var(--card)" stroke="var(--ink)" strokeWidth={2.2} />
      <path d="M346 556l64-62" {...ink} />
      <path d={`M-20 600${WAVE}`} {...ink} />
      <path d={`M-20 632${WAVE}`} {...soft} />
      <path d={`M-20 664${WAVE}`} {...soft} />
      <path d={`M-20 696${WAVE}`} {...soft} />
    </svg>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <aside className={styles.panel}>
        <Art />
        <div className={styles.brand}>
          <Logo size={40} label={null} />
          <span>BetterTavern</span>
        </div>
        <p className={styles.caption}>{t("auth.taglineLines")}</p>
      </aside>
      <div className={styles.formSide}>
        <div className={styles.column}>{children}</div>
      </div>
    </div>
  );
}

/** 窄屏时表单上面的 Logo 和介绍（宽屏它们在插画区里） */
export function NarrowIntro({ lead }: { lead?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={styles.narrowIntro}>
      <Logo size={48} />
      {lead ? <p className={styles.lead}>{t("auth.tagline")}</p> : null}
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
        {checked ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
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

