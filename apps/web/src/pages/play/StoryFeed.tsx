/**
 * 故事流（同 App 的 StoryFeed.tsx）：书名页、已完成的回合（memo 固定，不随流式文字重渲染）、正在生成的那一段，
 * 最后是行动区（选项、开始故事、失败时的重试，见 TurnActions.tsx），跟着正文一起滚动。
 *
 * “我的行动”和叙述是同一种字、浅一档的颜色，左边一道竖线，读起来是故事的一部分。叙述左右页边距 24，段落之间空 16，
 * 两端对齐；正文可以选中复制，用浏览器自己的右键菜单。流式光标是 3×20 的蓝色圆头竖条，不闪烁。
 * 已完成的回合用 content-visibility: auto：很长的故事也只排版看得见的部分，浏览器的“查找”照样能找到。
 * 写完结局的故事，最后一段下面居中一行“—END—”（叙述的字，浅一档），没有选项也没有别的按钮。
 * 鼠标移到更早的一段上，右上角出现“回到这里”（回退，docs/agent-runtime.md 第 8 节）；回退次数用完时那里写明已用完。
 * 没有鼠标的设备上它一直显示在这一段下面。
 */

import { memo, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { LANGUAGE_TAGS } from "@bettertavern/core/i18n/index";
import {
  actionNote,
  canRollbackTo,
  headTurn,
  isEnded,
  type PendingTurn,
  type Phase,
  type PlayState,
  type StoryTurn,
} from "@bettertavern/core/play/turnMachine";
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
 * 正文的字号：没设置字号时跟随浏览器字号（rem，以 17.5 为基准），设置后用固定的 px。
 * 写成 CSS 变量放在阅读页上，叙述和“我的行动”都用它。宋体还是黑体不放在变量里，阅读页上标 data-narr-font：
 * 字体组按语言分（tokens.css），要在正文所在的元素上按它的 lang 取，在外层取会拿到界面语言的那一组。
 */
export function narrativeVars(prefs: ReadingPrefs): CSSProperties {
  const size = readingSize(prefs);
  const ratio = lineHeightFor(size) / size;
  return {
    "--narr-size": prefs.size === null ? `${size / 16}rem` : `${size}px`,
    "--narr-leading": `${ratio}`,
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
  const { t } = useTranslation();
  return (
    <header className={styles.book}>
      <Cover seed={seed} blobId={blobId} width={coverWidth} height={112} surface="onFill" rounded={20} />
      <h1 className={styles.bookTitle}>{title}</h1>
      {card || protagonist ? (
        <div className={styles.bookChips}>
          {card ? <Pill label={card} className={styles.cardPill} /> : null}
          {protagonist ? <Pill label={t("play.iAm", { name: protagonist })} tone="acc" /> : null}
        </div>
      ) : null}
    </header>
  );
}

/**
 * 故事正文（叙述和“我的行动”）标上这一局的 lang（不跟界面语言）：读屏按它念，宋体按它选（tokens.css）。
 * 只标正文段落，搭建世界、写开场这类提示是界面文字，跟页面的 lang。
 */
type StoryLang = { lang: string | undefined };

/** “我的行动”：和叙述同样的字，颜色浅一档，左边一道竖线；读屏时前面加上“我的行动：” */
function ActionNote({ text, lang }: { text: string } & StoryLang) {
  const { t } = useTranslation();
  return (
    <p className={styles.note} lang={lang}>
      <span className={styles.srOnly}>{t("play.myActionPrefix")}</span>
      {text}
    </p>
  );
}

function Narrative({
  text,
  lang,
  dim,
  caret,
  interrupted,
}: StoryLang & {
  text: string;
  dim?: boolean;
  /** 光标：live 是蓝色，waiting 是灰色（重连、等结果）；不传就不画 */
  caret?: "live" | "waiting";
  interrupted?: boolean;
}) {
  const { t } = useTranslation();
  const parts = paragraphs(text);
  const caretNode = caret ? (
    <span className={cx(styles.caret, caret === "waiting" && styles.caretWaiting)} aria-hidden="true" />
  ) : null;
  if (parts.length === 0)
    return caretNode ? (
      <p className={styles.narrative} lang={lang}>
        {caretNode}
      </p>
    ) : null;
  return (
    <>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        return (
          <p key={i} className={cx(styles.narrative, "narrative", dim && styles.dim)} lang={lang}>
            {p}
            {last ? caretNode : null}
            {last && interrupted ? <span className={styles.cut}>{t("play.interrupted")}</span> : null}
          </p>
        );
      })}
    </>
  );
}

/** 这一段能不能回退：能（available）、次数用完了（used_up），或者不显示（null：最新一段、正在生成） */
export type RollbackState = "available" | "used_up" | null;

function rollbackState(state: PlayState, turn: StoryTurn): RollbackState {
  if (canRollbackTo(state, turn.id)) return "available";
  const idle = state.phase === "idle" || state.phase === "failed";
  return idle && state.rollbacksLeft <= 0 && headTurn(state)?.id !== turn.id ? "used_up" : null;
}

const TurnBlock = memo(function TurnBlock({
  turn,
  lang,
  rollback,
  onRollback,
}: { turn: StoryTurn; rollback: RollbackState; onRollback?: (turnId: string) => void } & StoryLang) {
  // “写结局”这类说明随界面语言：切换语言时这一块要跟着重画（它是 memo 的）
  const { t } = useTranslation();
  const note = actionNote(turn.action);
  return (
    <section className={cx(styles.turn, styles.settled)}>
      {note ? <ActionNote text={note} lang={lang} /> : null}
      <Narrative text={turn.narrative} lang={lang} />
      {rollback && onRollback ? (
        <div className={styles.turnTools}>
          {rollback === "available" ? (
            <button type="button" className={styles.rollback} onClick={() => onRollback(turn.id)}>
              <Icon name="back" size={14} />
              {t("play.rollbackHere")}
            </button>
          ) : (
            <span className={styles.rollbackUsedUp}>{t("play.rollbackUsedUp")}</span>
          )}
        </div>
      ) : null}
    </section>
  );
});

/** 第一次开场：先搭建世界，再写开场。当前一步是白色的圆角行 */
function OpeningSteps({ building }: { building: boolean }) {
  const { t } = useTranslation();
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
        {step(building ? t("play.building") : t("play.buildWorld"), building ? "active" : "done")}
        {step(building ? t("play.writeOpening") : t("play.writingOpeningStep"), building ? "todo" : "active")}
      </div>
      <p className={styles.stepNote}>{t("play.slowNote")}</p>
    </div>
  );
}

function PendingBlock({ pending, phase, lang }: { pending: PendingTurn; phase: Phase } & StoryLang) {
  const failed = phase === "failed";
  const opening = pending.action?.source === "opening";
  const note = actionNote(pending.action);
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
      {note ? <ActionNote text={note} lang={lang} /> : null}
      <Narrative
        text={pending.narrative}
        lang={lang}
        dim={failed}
        caret={caret}
        interrupted={failed && pending.narrative.length > 0}
      />
    </section>
  );
}

/** 开场还没写（上次中断了） */
function OpeningMissing() {
  const { t } = useTranslation();
  return (
    <div className={styles.missing}>
      <span className={styles.missingIcon}>
        <Icon name="untested" size={18} />
      </span>
      {t("play.noOpening")}
    </div>
  );
}

export function StoryFeed({
  state,
  header,
  footer,
  onRollback,
}: {
  state: PlayState;
  header?: ReactNode;
  /** 接在最后一段后面的行动区 */
  footer?: ReactNode;
  /** 点了某一段的“回到这里”（要稳定的函数，否则每段都会重画） */
  onRollback?: (turnId: string) => void;
}) {
  const { t } = useTranslation();
  const missingOpening = state.turns.length === 0 && state.phase === "idle";
  const lang = LANGUAGE_TAGS[state.language];
  return (
    <>
      {header}
      {state.turns.map((turn) => (
        <TurnBlock
          key={turn.id}
          turn={turn}
          lang={lang}
          rollback={rollbackState(state, turn)}
          onRollback={onRollback}
        />
      ))}
      {state.pending ? <PendingBlock pending={state.pending} phase={state.phase} lang={lang} /> : null}
      {missingOpening ? <OpeningMissing /> : null}
      {isEnded(state) ? (
        <p className={styles.end} aria-label={t("play.theEnd")}>
          —END—
        </p>
      ) : null}
      {footer}
    </>
  );
}
