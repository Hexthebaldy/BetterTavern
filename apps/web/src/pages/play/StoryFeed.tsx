/**
 * 故事流（docs/design/comic 的 09，第一版只用现有的数据）：直接写在页面上的一整篇正文，没有任何边框；回合之间不画线，也不多空，和段与段之间一样。
 * - 每回合先是玩家这一回合的行动（“我的行动”），再是叙述；两者都从左往右排、用同样的正文字体，
 *   行动只在左边多一道蓝色竖线，读屏时前面加“我的行动：”；
 * - 叙述的段与段之间空一点，不一段一个框；
 * - 正在生成的那一段末尾是蓝色光标（3×20 的圆头竖条，不闪烁），重连、等结果时是灰色；
 * - 写完结局的故事，最后一格下面居中一行“—END—”，没有选项也没有别的按钮。
 * 已完成的回合 memo 固定（不随流式文字重渲染），用 content-visibility: auto，很长的故事也只排版看得见的部分。
 * 鼠标移到更早的一格上，右上角出现“回到这里”（回退，docs/agent-runtime.md 第 8 节）；回退次数用完时写明已用完。
 * 没有鼠标的设备上它一直显示。设计稿里带说话人的台词气泡和拟声词小格要导演在输出里标出来，这一版不做。
 * 多角色的局（docs/cast.md）按 segments 一段一段排：角色那一段前面是头像和名字，旁白那一段和普通叙述一样（CastPicker.tsx）。
 */

import { memo, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { CastMember } from "@bettertavern/core/api/types";
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

import { Panel } from "../../components/comic.tsx";
import { cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { CastSegments } from "./CastPicker.tsx";
import styles from "./play.module.css";

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * 正文的字号：没设置字号时跟随浏览器字号（rem，以 17.5 为基准），设置后用固定的 px。
 * 写成 CSS 变量放在阅读页上，旁白框和“我的行动”都用它。宋体还是黑体不放在变量里，阅读页上标 data-narr-font：
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

/** 回合在页面里的锚点（左栏回想点一下滚到这里） */
export function turnAnchor(seq: number): string {
  return `turn-${seq}`;
}

/**
 * 故事正文（叙述和“我的行动”）标上这一局的 lang（不跟界面语言）：读屏按它念，宋体按它选（tokens.css）。
 * 只标正文段落，搭建世界、写开场这类提示是界面文字，跟页面的 lang。
 */
type StoryLang = { lang: string | undefined };

/** “我的行动”：和叙述一样从左往右排、同样的字，只在左边多一道蓝色竖线 */
function ActionLine({ text, lang }: { text: string } & StoryLang) {
  const { t } = useTranslation();
  return (
    <p className={styles.action} lang={lang}>
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
    <div className={cx(styles.prose, dim && styles.dim)}>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        return (
          <p key={i} className={cx(styles.narrative, "narrative")} lang={lang}>
            {p}
            {last ? caretNode : null}
            {last && interrupted ? <span className={styles.cut}>{t("play.interrupted")}</span> : null}
          </p>
        );
      })}
    </div>
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
  cast,
  lang,
  rollback,
  onRollback,
}: {
  turn: StoryTurn;
  cast: readonly CastMember[];
  rollback: RollbackState;
  onRollback?: (turnId: string) => void;
} & StoryLang) {
  // “写结局”这类说明随界面语言：切换语言时这一块要跟着重画（它是 memo 的）
  const { t } = useTranslation();
  const note = actionNote(turn.action);
  const narrative = turn.narrative.trim();
  return (
    <section className={cx(styles.turn, styles.settled)} id={turnAnchor(turn.seq)}>
      {note || narrative ? (
        <div className={styles.frame}>
          {note ? <ActionLine text={note} lang={lang} /> : null}
          {turn.segments.length > 0 ? (
            <CastSegments
              segments={turn.segments}
              cast={cast}
              render={(segment) => <Narrative text={segment.text} lang={lang} />}
            />
          ) : narrative ? (
            <Narrative text={turn.narrative} lang={lang} />
          ) : null}
          {rollback && onRollback ? (
            <div className={styles.turnTools}>
              {rollback === "available" ? (
                <button type="button" className={styles.rollback} onClick={() => onRollback(turn.id)}>
                  <Icon name="back" size={14} strokeWidth={2.2} />
                  {t("play.rollbackHere")}
                </button>
              ) : (
                <span className={styles.rollbackUsedUp}>{t("play.rollbackUsedUp")}</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

/** 第一次开场：先搭建世界，再写开场。当前一步是蓝底的一行 */
function OpeningSteps({ building }: { building: boolean }) {
  const { t } = useTranslation();
  const step = (label: string, state: "active" | "done" | "todo") => (
    <div className={cx(styles.stepRow, state === "active" && styles.stepActive, state === "done" && styles.stepDone)}>
      <span className={styles.stepMark}>
        {state === "active" ? <span className={styles.stepDot} /> : null}
        {state === "done" ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
      </span>
      {label}
    </div>
  );
  return (
    <Panel tone="dots" className={styles.frame} aria-label={t("play.opening")}>
      <div aria-live="polite" className={styles.steps}>
        {step(building ? t("play.building") : t("play.buildWorld"), building ? "active" : "done")}
        {step(building ? t("play.writeOpening") : t("play.writingOpeningStep"), building ? "todo" : "active")}
        <p className={styles.stepNote}>{t("play.slowNote")}</p>
      </div>
    </Panel>
  );
}

function PendingBlock({
  pending,
  phase,
  cast,
  lang,
}: { pending: PendingTurn; phase: Phase; cast: readonly CastMember[] } & StoryLang) {
  const failed = phase === "failed";
  const opening = pending.action?.source === "opening";
  const note = actionNote(pending.action);
  const caret =
    failed || phase === "submitting"
      ? undefined
      : phase === "reconnecting" || phase === "polling"
        ? "waiting"
        : "live";
  if (opening && !failed && pending.narrative === "") return <OpeningSteps building={pending.buildingWorld} />;
  return (
    <section className={styles.turn} id={pending.seq !== null ? turnAnchor(pending.seq) : undefined}>
      {note || pending.narrative || caret ? (
        <div className={styles.frame}>
          {note ? <ActionLine text={note} lang={lang} /> : null}
          {pending.segments.length > 0 ? (
            <CastSegments
              segments={pending.segments}
              cast={cast}
              render={(segment, last) => (
                <Narrative
                  text={segment.text}
                  lang={lang}
                  dim={failed}
                  caret={last ? caret : undefined}
                  interrupted={last && failed && segment.text.length > 0}
                />
              )}
            />
          ) : pending.narrative || caret ? (
            <Narrative
              text={pending.narrative}
              lang={lang}
              dim={failed}
              caret={caret}
              interrupted={failed && pending.narrative.length > 0}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 开场还没写（上次中断了） */
function OpeningMissing() {
  const { t } = useTranslation();
  return (
    <Panel tone="grey" className={styles.missing}>
      <Icon name="untested" size={18} />
      {t("play.noOpening")}
    </Panel>
  );
}

export function StoryFeed({
  state,
  footer,
  onRollback,
}: {
  state: PlayState;
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
      {state.turns.map((turn) => (
        <TurnBlock
          key={turn.id}
          turn={turn}
          cast={state.cast}
          lang={lang}
          rollback={rollbackState(state, turn)}
          onRollback={onRollback}
        />
      ))}
      {state.pending ? (
        <PendingBlock pending={state.pending} phase={state.phase} cast={state.cast} lang={lang} />
      ) : null}
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
