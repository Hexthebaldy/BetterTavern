/**
 * 登录、注册的版式（W01、W02，同平板宽屏 T01）：
 * - ≥ 900：左右分栏。左侧插画区宽 47.3%，离窗口 16，圆角 32，灰底，有 Logo、插画和一句介绍；右侧表单宽 400，在右半边居中。
 * - 600–899：表单宽 440 居中；< 600：整宽。窄屏的 Logo 和介绍在表单上面。
 * 网页和接口同源，没有 App 底部的“服务器”入口。
 */

import type { ReactNode } from "react";

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
  return (
    <div className={styles.page}>
      <aside className={styles.panel}>
        <Art />
        <div className={styles.brand}>
          <Logo size={40} label={null} />
          <span>BetterTavern</span>
        </div>
        <p className={styles.caption}>
          导入一张角色卡，
          <br />
          用第一人称把故事写下去。
        </p>
      </aside>
      <div className={styles.formSide}>
        <div className={styles.column}>{children}</div>
      </div>
    </div>
  );
}

/** 窄屏时表单上面的 Logo 和介绍（宽屏它们在插画区里） */
export function NarrowIntro({ lead }: { lead?: boolean }) {
  return (
    <div className={styles.narrowIntro}>
      <Logo size={48} />
      {lead ? <p className={styles.lead}>导入一张角色卡，用第一人称把故事写下去。</p> : null}
    </div>
  );
}
