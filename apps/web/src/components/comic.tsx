/**
 * 漫画分镜版的部件（docs/design/comic 的“部件”一节，数值取自 source/*.dc.html）：
 * - Panel：格子，五种底（白、墨、蓝网点、白底墨点、灰网点），最重要的那一格加“热”的大投影；
 * - Bubble：对话气泡，尾巴在左下、右下、左上或右上，左上角一块墨底小标签写说话人；玩家自己的话用蓝底；
 * - Caption：旁白框（宋体，圆角 6）；
 * - Keycap：键帽（高 26，2px 描边，等宽粗体），在墨底上是浅蓝；
 * - Portrait：人物位，有角色卡头像就用头像，没有就用名字里的一个大字压在网点底上；
 * - HintBar：阅读页底部 48 高的墨条，写当前能按的键。
 * 格子要做成链接或按钮时，用 panelClass() 拿到同样的类名。
 */

import { useState, type CSSProperties, type ElementType, type ReactNode } from "react";

import { useBlobUrl } from "../data/blobs.ts";
import styles from "./comic.module.css";
import { cx } from "./controls.tsx";
import { isDarkTone, portraitGlyph, portraitTone, type PanelTone } from "@bettertavern/design/portrait";

export type { PanelTone };

/** 格子的类名：tone 是底，hot 是最重要的那一格（--x8 投影），big 是大面板（圆角 22） */
export function panelClass(tone: PanelTone = "white", options: { hot?: boolean; big?: boolean } = {}): string {
  return cx(styles.panel, styles[`tone-${tone}`], options.hot && styles.hot, options.big && styles.big);
}

export function Panel({
  tone = "white",
  hot,
  big,
  as: Tag = "div",
  className,
  style,
  children,
  ...rest
}: {
  tone?: PanelTone;
  hot?: boolean;
  big?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  role?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Tag className={cx(panelClass(tone, { hot, big }), className)} style={style} {...rest}>
      {children}
    </Tag>
  );
}

/** 气泡的尾巴：一个往下的尖角，上面盖一条和气泡同色的条，把气泡的边线遮掉，尖角就和气泡连成一体 */
function Tail() {
  return (
    <svg className={styles.tail} viewBox="0 0 26 20" aria-hidden="true">
      <path d="M1 0 L9 18 L23 0" />
      <rect x="2.4" y="-1.5" width="19.5" height="3.2" />
    </svg>
  );
}

export function Bubble({
  who,
  tail = "left",
  tone = "white",
  small,
  className,
  lang,
  children,
}: {
  /** 左上角的说话人（尾巴在左上时挪到右上角） */
  who?: ReactNode;
  /** 尾巴：left 左下、right 右下、up 左上、upRight 右上 */
  tail?: "left" | "right" | "up" | "upRight" | "none";
  /** blue：玩家自己的行动 */
  tone?: "white" | "blue";
  /** 小号（格子里的一句台词）：字小一档，内边距小一点 */
  small?: boolean;
  className?: string;
  lang?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        styles.bubble,
        tone === "blue" && styles.bubbleBlue,
        tail === "right" && styles.tailRight,
        tail === "up" && styles.tailUp,
        tail === "upRight" && styles.tailUpRight,
        small && styles.bubbleSmall,
        className,
      )}
      lang={lang}
    >
      {who ? <span className={styles.who}>{who}</span> : null}
      {children}
      {tail === "none" ? null : <Tail />}
    </div>
  );
}

/**
 * 旁白框。clamp 时只显示前几行（行数由外面的 CSS 变量 --lines 定，默认 3）：截断放在里面一层，
 * 不然框的内边距里会露出下一行的上半截。
 */
export function Caption({
  className,
  lang,
  as: Tag = "div",
  clamp,
  children,
}: {
  className?: string;
  lang?: string;
  as?: ElementType;
  clamp?: boolean;
  children: ReactNode;
}) {
  return (
    <Tag className={cx(styles.caption, className)} lang={lang}>
      {clamp ? <span className={styles.clamp}>{children}</span> : children}
    </Tag>
  );
}

/** 键帽：line 是透明底、描边跟着字色（墨底上是浅蓝）；solid 是白底墨字，下面一道墨色的厚边 */
export function Keycap({
  children,
  tone = "line",
  className,
}: {
  children: ReactNode;
  tone?: "line" | "solid";
  className?: string;
}) {
  return <kbd className={cx(styles.keycap, tone === "solid" && styles.keycapSolid, className)}>{children}</kbd>;
}

/**
 * 人物位：有头像（角色卡图片）就铺满，没有或取不到时是名字里的一个大字压在网点底上。
 * 底按 seed（通常是角色卡 ID）选，同一个人物在各页一样；大字的字号跟着格子的大小走（容器查询）。
 * 不给 size 时撑满父元素（父元素要有确定的宽高）。
 */
export function Portrait({
  name,
  seed,
  blobId,
  tone,
  glyph,
  size,
  radius,
  className,
}: {
  name: string;
  seed: string;
  blobId?: string | null;
  tone?: PanelTone;
  /** 不按名字取，直接给定大字（模型页的“导”“整”“工”） */
  glyph?: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  const image = useBlobUrl(blobId);
  const [broken, setBroken] = useState(false);
  const bg = tone ?? portraitTone(seed);
  const showImage = !!blobId && !image.isError && !broken;
  const style: CSSProperties = {
    ...(size ? { width: size, height: size } : null),
    ...(radius !== undefined ? { borderRadius: radius } : null),
  };
  return (
    <span
      className={cx(styles.portrait, styles[`tone-${bg}`], isDarkTone(bg) && styles.dark, className)}
      style={style}
      aria-hidden="true"
    >
      {showImage ? (
        image.data ? (
          <img
            src={image.data}
            alt=""
            draggable={false}
            className={styles.portraitImage}
            onError={() => setBroken(true)}
          />
        ) : null
      ) : (
        <span className={styles.glyph}>{glyph ?? portraitGlyph(name)}</span>
      )}
    </span>
  );
}

export type Hint = { keys: string[]; label: string };

/** 底部提示条：一排键帽加说明，键帽是浅蓝 */
export function HintBar({ items, label, className }: { items: Hint[]; label: string; className?: string }) {
  return (
    <div className={cx(styles.hintBar, className)} role="note" aria-label={label}>
      {items.map((item) => (
        <span key={item.label} className={styles.hint}>
          {item.keys.map((key) => (
            <Keycap key={key}>{key}</Keycap>
          ))}
          {item.label}
        </span>
      ))}
    </div>
  );
}
