/**
 * 接在分镜最后一格后面的行动区（docs/design/comic 的 09），跟着正文一起滚动：
 * - 空闲：“接下来，你要——”和模型给的选项卡（左上角键帽 A–D；三张以内一行，四张两行；指着、按下时墨底配蓝投影），
 *   下面是虚线框的“自己写”（键 /），点开原地变成输入框：Enter 发送，Shift + Enter 换行，输入法组字时的 Enter 不发送，
 *   Esc 收起，草稿留着；
 * - 生成中：状态（正在发送 / 正在构思 / 正在回想前情 / 正在写下一段 / 正在写结局；重连、等结果时是琥珀色）和“停止”；
 * - 同步中：锁和“同步完成前暂时不能行动”；写完结局：旗子和“故事已完结”；
 * - 开场没写：“开始故事”；失败：错误格加重试 / 换个行动（没有模型时去模型页）。
 */

import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { describeTurnError } from "@bettertavern/core/api/client";
import type { TurnOption } from "@bettertavern/core/api/types";
import {
  canAct,
  canRetry,
  headTurn,
  isEnded,
  isLive,
  needsOpening,
  type PlayState,
} from "@bettertavern/core/play/turnMachine";
import { needsModelSettings } from "@bettertavern/core/settings/labels";

import { Keycap, Panel } from "../../components/comic.tsx";
import { Button, buttonClass, cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./play.module.css";
import { isSendKey, optionColumns } from "./reading.ts";
import type { PlayControls } from "./usePlaySession.ts";

const KEYS = ["A", "B", "C", "D"];
const MAX_TEXT = 2000;

function OptionCard({
  option,
  index,
  disabled,
  onPick,
}: {
  option: TurnOption;
  index: number;
  disabled: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  // 按下即选中：墨底、蓝色投影（提交后选项就消失了）
  const [chosen, setChosen] = useState(false);
  return (
    <button
      type="button"
      className={cx(styles.option, chosen && styles.optionOn)}
      disabled={disabled}
      aria-keyshortcuts={KEYS[index]}
      onClick={() => {
        setChosen(true);
        onPick();
      }}
    >
      <Keycap className={styles.optionKey}>{KEYS[index] ?? "·"}</Keycap>
      <span className={styles.optionText}>
        <span className={styles.srOnly}>{t("play.optionLabel", { key: KEYS[index] ?? "", text: "" })}</span>
        {option.text}
      </span>
    </button>
  );
}

function LiveStatus({ state, onStop }: { state: PlayState; onStop: (() => void) | null }) {
  const { t } = useTranslation();
  const warn = state.phase === "reconnecting" || state.phase === "polling";
  const source = state.pending?.action?.source;
  const pending = state.pending;
  const label =
    state.phase === "reconnecting"
      ? t("play.reconnecting")
      : state.phase === "polling"
        ? t("play.polling")
        : state.phase === "submitting"
          ? t("play.sending")
          : pending?.narrative === ""
            ? pending.recalling
              ? t("play.recalling")
              : t("play.thinking")
            : source === "opening"
              ? t("play.writingOpening")
              : source === "ending"
                ? t("play.writingEnding")
                : t("play.writingNext");
  return (
    <div className={cx(styles.statusRow, warn && styles.statusWarn)}>
      <span className={styles.status} aria-live="polite">
        <span className={styles.liveDot} />
        {label}
      </span>
      {onStop ? (
        <Button label={t("common.stop")} icon="stop" variant="secondary" size="sm" onClick={onStop} />
      ) : null}
    </div>
  );
}

/** “自己写”：收着是一条虚线框；点开（或按 /）原地变成输入框 */
function WriteBox({
  writing,
  draft,
  disabled,
  onDraft,
  onOpen,
  onClose,
  onSend,
}: {
  writing: boolean;
  draft: string;
  disabled: boolean;
  onDraft: (text: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const trimmed = draft.trim();
  const left = MAX_TEXT - draft.length;
  const blocked = disabled || !trimmed;
  useEffect(() => {
    if (!writing) return;
    const node = input.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [writing]);

  if (!writing) {
    return (
      <button
        type="button"
        className={styles.writeBox}
        disabled={disabled}
        aria-label={draft ? t("play.continueDraft") : t("play.writeOwn")}
        aria-keyshortcuts="/"
        onClick={onOpen}
      >
        <Icon name="write" size={18} strokeWidth={2.2} />
        <span className={cx(styles.writeText, draft && styles.writeDraft)}>
          {draft || t("play.writeOwnPlaceholder")}
        </span>
        <Keycap className={styles.writeKey}>/</Keycap>
        <span className={buttonClass("primary", "sm")} aria-hidden="true">
          {t("play.send")}
        </span>
      </button>
    );
  }
  return (
    <div className={styles.inputBlock}>
      <textarea
        ref={input}
        className={styles.textarea}
        value={draft}
        maxLength={MAX_TEXT}
        placeholder={t("play.inputPlaceholder")}
        aria-label={t("play.inputLabel")}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (isSendKey({ ...e, isComposing: e.nativeEvent.isComposing })) {
            e.preventDefault();
            if (!blocked) onSend(trimmed);
          }
        }}
      />
      <div className={styles.inputRow}>
        <button type="button" className={styles.collapse} onClick={onClose}>
          <Icon name="chevronDown" size={18} strokeWidth={2.2} />
          {t("common.collapse")}
        </button>
        {left <= 200 ? <span className={styles.left}>{t("play.left", { n: left })}</span> : null}
        <span className={styles.sendHint}>
          <Trans i18nKey="play.inputKeys" components={{ kbd: <kbd /> }} />
        </span>
        <Button label={t("play.send")} icon="send" size="sm" disabled={blocked} onClick={() => onSend(trimmed)} />
      </div>
    </div>
  );
}

export function TurnActions({
  state,
  controls,
  onOpenSettings,
  onPicked,
  writing,
  draft,
  onDraft,
  onWrite,
  onCloseWrite,
  onSend,
}: {
  state: PlayState;
  controls: PlayControls;
  onOpenSettings: () => void;
  /** 选了一个选项（输入框开着时顺手收起，草稿留着） */
  onPicked: () => void;
  writing: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onWrite: () => void;
  onCloseWrite: () => void;
  onSend: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (state.phase === "loading" || state.phase === "load_failed") return null;

  if (state.phase === "failed" && state.error) {
    const routeMissing = state.error.code === "ROUTE_MISSING";
    const toSettings = needsModelSettings(state.error.code);
    const opening = state.turns.length === 0;
    return (
      <div className={styles.area}>
        <Panel className={styles.failCard}>
          <Icon name="alert" size={20} />
          <span role="alert">
            {routeMissing
              ? t("play.noModel")
              : state.pending?.narrative
                ? t("play.unfinished", { error: describeTurnError(state.error) })
                : describeTurnError(state.error)}
          </span>
        </Panel>
        <div className={styles.failButtons}>
          <Button
            label={opening ? t("common.close") : t("play.changeAction")}
            variant="secondary"
            onClick={controls.dismissError}
          />
          {toSettings ? (
            <Button label={t("play.goModels")} onClick={onOpenSettings} />
          ) : canRetry(state) ? (
            <Button label={t("common.retry")} icon="retry" onClick={controls.retry} />
          ) : null}
        </div>
      </div>
    );
  }
  if (needsOpening(state)) {
    return (
      <div className={styles.area}>
        <Button
          label={t("start.button")}
          size="lg"
          between
          trailingIcon="arrowRight"
          className={styles.wide}
          onClick={() => controls.submit({ source: "opening" })}
        />
      </div>
    );
  }
  if (isLive(state)) {
    const cancellable = state.pending?.turnId != null && state.phase !== "submitting";
    return (
      <div className={styles.area}>
        <LiveStatus state={state} onStop={cancellable ? controls.cancel : null} />
      </div>
    );
  }
  if (state.phase === "syncing") {
    return (
      <div className={cx(styles.area, styles.statusRow, styles.statusMuted)}>
        <span className={styles.status}>
          <Icon name="lock" size={18} />
          {t("play.syncBlocked")}
        </span>
      </div>
    );
  }
  if (isEnded(state)) {
    return (
      <div className={cx(styles.area, styles.statusRow, styles.statusMuted)}>
        <span className={styles.status}>
          <Icon name="flag" size={18} />
          {t("play.ended")}
        </span>
      </div>
    );
  }
  if (state.phase !== "idle" || state.turns.length === 0) return null;
  const options = headTurn(state)?.options ?? [];
  const enabled = canAct(state);
  return (
    <div className={styles.area}>
      {options.length > 0 ? (
        <>
          <p className={styles.nextLine}>
            <b>{t("play.nextPrompt")}</b>
            <span>{t("play.nextNote", { count: options.length })}</span>
          </p>
          <div className={styles.options} style={{ gridTemplateColumns: `repeat(${optionColumns(options.length)}, minmax(0, 1fr))` }}>
            {options.map((option, i) => (
              <OptionCard
                key={option.id}
                option={option}
                index={i}
                disabled={!enabled}
                onPick={() => {
                  onPicked();
                  controls.submit({ source: "option", option_id: option.id });
                }}
              />
            ))}
          </div>
        </>
      ) : (
        <p className={styles.noOptions}>{t("play.noOptions")}</p>
      )}
      <WriteBox
        writing={writing && enabled}
        draft={draft}
        disabled={!enabled}
        onDraft={onDraft}
        onOpen={onWrite}
        onClose={onCloseWrite}
        onSend={onSend}
      />
    </div>
  );
}
