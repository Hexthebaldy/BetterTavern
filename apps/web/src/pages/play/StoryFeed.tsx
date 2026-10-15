/**
 * 故事流（同 App 的 StoryFeed.tsx）：书名页、已完成的回合（memo 固定，不随流式文字重渲染）、正在生成的那一段，
 * 最后是行动区（选项、开始故事、失败时的重试，见 TurnActions.tsx），跟着正文一起滚动。
 *
 * “我的行动”和叙述是同一种字、浅一档的颜色，左边一道竖线，读起来是故事的一部分。叙述左右页边距 24，段落之间空 16，
 * 两端对齐；正文可以选中复制，用浏览器自己的右键菜单。流式光标是 3×20 的蓝色圆头竖条，不闪烁。
 * 已完成的回合用 content-visibility: auto：很长的故事也只排版看得见的部分，浏览器的“查找”照样能找到。
 */

import { memo, type CSSProperties, type ReactNode } from "react";

import type { PendingTurn, Phase, PlayState, StoryTurn } from "@bettertavern/core/play/turnMachine";
import { lineHeightFor, readingSize, type ReadingPrefs } from "@bettertavern/core/play/reading";

import { Cover } from "../../components/Cover.tsx";
import { cx, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./play.module.css";

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * 正文的字体和字号：没设置字号时跟随浏览器字号（rem，以 17.5 为基准），设置后用固定的 px。
 * 写成 CSS 变量放在故事流上，叙述和“我的行动”都用它。
 */
export function narrativeVars(prefs: ReadingPrefs): CSSProperties {
  const size = readingSize(prefs);
  const ratio = lineHeightFor(size) / size;
  return {
    "--narr-size": prefs.size === null ? `${size / 16}rem` : `${size}px`,
    "--narr-leading": `${ratio}`,
    "--narr-font": prefs.font === "serif" ? "var(--font-serif)" : "var(--font-sans)",
  } as CSSProperties;
}

/** 书名页：往上翻到顶看到的第一屏（灰色圆角卡片，里面是封面、书名和两个小标签） */
export function BookHeader({
  seed,
  blobId,
  title,
  card,
  protagonist,
  coverWidth,
}: {
  seed: string;
  blobId: string | null;
  title: string;
  card: string | null;
  protagonist: string;
  coverWidth: number;
}) {
  return (
    <header className={styles.book}>
      <Cover seed={seed} blobId={blobId} width={coverWidth} height={112} surface="onFill" rounded={20} />
      <h1 className={styles.bookTitle}>{title}</h1>
      {card || protagonist ? (
        <div className={styles.bookChips}>
          {card ? <Pill label={card} className={styles.cardPill} /> : null}
          {protagonist ? <Pill label={`我是 ${protagonist}`} tone="acc" /> : null}
        </div>
      ) : null}
    </header>
  );
}

/** “我的行动”：和叙述同样的字，颜色浅一档，左边一道竖线；读屏时前面加上“我的行动：” */
function ActionNote({ text }: { text: string }) {
  return (
    <p className={styles.note}>
      <span className={styles.srOnly}>我的行动：</span>
      {text}
    </p>
  );
}

function Narrative({
  text,
  dim,
  caret,
  interrupted,
}: {
  text: string;
  dim?: boolean;
  /** 光标：live 是蓝色，waiting 是灰色（重连、等结果）；不传就不画 */
  caret?: "live" | "waiting";
  interrupted?: boolean;
}) {
  const parts = paragraphs(text);
  const caretNode = caret ? (
    <span className={cx(styles.caret, caret === "waiting" && styles.caretWaiting)} aria-hidden="true" />
  ) : null;
  if (parts.length === 0) return caretNode ? <p className={styles.narrative}>{caretNode}</p> : null;
  return (
    <>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        return (
          <p key={i} className={cx(styles.narrative, "narrative", dim && styles.dim)}>
            {p}
            {last ? caretNode : null}
            {last && interrupted ? <span className={styles.cut}>中断</span> : null}
          </p>
        );
      })}
    </>
  );
}

const TurnBlock = memo(function TurnBlock({ turn }: { turn: StoryTurn }) {
  const showAction = turn.action.source !== "opening" && turn.action.text.length > 0;
  return (
    <section className={cx(styles.turn, styles.settled)}>
      {showAction ? <ActionNote text={turn.action.text} /> : null}
      <Narrative text={turn.narrative} />
    </section>
  );
});

/** 第一次开场：先搭建世界，再写开场。当前一步是白色的圆角行 */
function OpeningSteps({ building }: { building: boolean }) {
  const step = (label: string, state: "active" | "done" | "todo") => (
    <div className={cx(styles.stepRow, state === "active" && styles.stepActive)}>
      <span className={cx(styles.stepMark, styles[`mark-${state}`])}>
        {state === "active" ? <span className={styles.stepDot} /> : null}
        {state === "done" ? <Icon name="check" size={14} strokeWidth={2.4} /> : null}
      </span>
      {label}
    </div>
  );
  return (
    <div aria-live="polite">
      <div className={styles.steps}>
        {step(building ? "正在根据角色卡搭建世界…" : "搭建世界", building ? "active" : "done")}
        {step(building ? "写开场" : "正在写开场…", building ? "todo" : "active")}
      </div>
      <p className={styles.stepNote}>第一次开场比较慢。可以先离开，写好后会出现在“故事”里。</p>
    </div>
  );
}

function PendingBlock({ pending, phase }: { pending: PendingTurn; phase: Phase }) {
  const failed = phase === "failed";
  const opening = pending.action?.source === "opening";
  const showAction = pending.action && !opening && pending.action.text.length > 0;
  const caret =
    failed || phase === "submitting"
      ? undefined
      : phase === "reconnecting" || phase === "polling"
        ? "waiting"
        : "live";
  if (opening && !failed && pending.narrative === "")
    return <OpeningSteps building={pending.buildingWorld} />;
  return (
    <section className={styles.turn}>
      {showAction && pending.action ? <ActionNote text={pending.action.text} /> : null}
      <Narrative
        text={pending.narrative}
        dim={failed}
        caret={caret}
        interrupted={failed && pending.narrative.length > 0}
      />
    </section>
  );
}

/** 开场还没写（上次中断了） */
function OpeningMissing() {
  return (
    <div className={styles.missing}>
      <span className={styles.missingIcon}>
        <Icon name="untested" size={18} />
      </span>
      开场还没有写好，上次可能中断了。
    </div>
  );
}

export function StoryFeed({
  state,
  header,
  footer,
}: {
  state: PlayState;
  header?: ReactNode;
  /** 接在最后一段后面的行动区 */
  footer?: ReactNode;
}) {
  const missingOpening = state.turns.length === 0 && state.phase === "idle";
  return (
    <>
      {header}
      {state.turns.map((turn) => (
        <TurnBlock key={turn.id} turn={turn} />
      ))}
      {state.pending ? <PendingBlock pending={state.pending} phase={state.phase} /> : null}
      {missingOpening ? <OpeningMissing /> : null}
      {footer}
    </>
  );
}
