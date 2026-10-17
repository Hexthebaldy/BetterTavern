/** 设置页共用的小件：服务商标记、API Key 输入框、分节标题、页头 */

import type { ReactNode } from "react";

import { providerLogo } from "@bettertavern/design/providerLogos";

import { cx, Field } from "../../components/controls.tsx";
import styles from "./settings.module.css";

export type MarkTone = "ink" | "acc" | "card" | "grey";

/**
 * 服务商的圆形标记（同 App 的 KeyParts.tsx）：有标志的画标志（@bettertavern/design 的 providerLogos.ts，
 * 品牌原色；单色标志用 currentColor），没有的（自定义端点）写 { }。ink = 正在用作导演，acc = 选中的服务商。
 * 有标志时选中也不把圆涂成蓝色（DeepSeek 的蓝色标志会看不见），选中靠图块自己的浅蓝底和描边。
 */
export function ProviderMark({
  provider,
  size = 40,
  tone = "card",
}: {
  provider: string;
  size?: number;
  tone?: MarkTone;
}) {
  const logo = providerLogo(provider);
  const shown: MarkTone = logo && tone === "acc" ? "card" : tone;
  const glyph = Math.round(size * 0.56);
  return (
    <span
      className={cx(styles.mark, styles[`mark-${shown}`])}
      style={{ width: size, height: size, fontSize: size > 40 ? 13 : size > 30 ? 12 : 10 }}
      aria-hidden="true"
    >
      {logo ? (
        <svg width={glyph} height={glyph} viewBox={logo.viewBox} fillRule={logo.fillRule}>
          {logo.paths.map((p, i) => (
            <path key={i} d={p.d} fill={p.fill ?? "currentColor"} />
          ))}
        </svg>
      ) : (
        "{ }"
      )}
    </span>
  );
}

/**
 * API Key 输入框：等宽，输入的内容用圆点遮住（不用 type=password，免得浏览器把它当成网站密码保存）。
 * 网页里直接 ⌘ / Ctrl + V 粘贴，不需要 App 那个“粘贴”按钮。
 */
export function KeyField(props: Omit<Parameters<typeof Field>[0], "type">) {
  return (
    <Field
      {...props}
      className={cx(styles.keyField, props.className)}
      type="text"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      data-1p-ignore=""
      data-lpignore="true"
    />
  );
}

export function SectionHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {meta ? <span className={styles.sectionMeta}>{meta}</span> : null}
    </div>
  );
}

export function BodyHead({ title, lead, mono }: { title: ReactNode; lead?: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.bodyHead}>
      <h2 className={cx(styles.bodyTitle, mono && styles.monoTitle)}>{title}</h2>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
    </div>
  );
}
