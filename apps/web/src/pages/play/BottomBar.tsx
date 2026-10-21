/**
 * 阅读页底部固定的操作栏（同 App 的 BottomBar.tsx）：左边“世界”，右边“更多”，中间一格按状态换内容。
 *
 * - 空闲：“自己写…”（有草稿时显示草稿，桌面上右端有键帽 /），点一下原地展开成输入框（W08）；
 * - 生成中：状态（正在发送 / 正在构思 / 正在回想前情 / 世界还在更新 / 正在写下一段 / 正在写结局）和“停止”；重连、等结果时是琥珀色；
 * - 同步中：锁和“同步完成前暂时不能行动”；还没开场时空着（“开始故事”在正文末尾）；
 * - 写完结局：旗子和灰字“故事已完结”，不能再写。
 * 离开了最新位置时，中间这一格右端展开一个下箭头圆按钮（灰底，生成中带蓝点），“自己写…”跟着变窄。
 * 贴着窗口底边，页面底色加顶上一条细线；内容宽 672，和阅读栏同一条中线。
 */

import { useEffect, useRef, type Ref } from "react";
import { Trans, useTranslation } from "react-i18next";

import { canAct, isEnded, isLive, needsOpening, type PlayState } from "@bettertavern/core/play/turnMachine";

import { cx, IconButton } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./play.module.css";
import { isSendKey } from "./reading.ts";
import type { PlayControls } from "./usePlaySession.ts";

const MAX_TEXT = 2000;

function LiveStatus({ state }: { state: PlayState }) {
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
    <div className={cx(styles.status, warn && styles.statusWarn)} aria-live="polite">
      <span className={styles.liveDot} />
      <span className={styles.statusText}>{label}</span>
    </div>
  );
}

/** 展开后的输入框（W08）：Enter 发送，Shift + Enter 换行，输入法组字时的 Enter 不发送；Esc 收起，草稿留着 */
function FreeInput({
  draft,
  onDraft,
  disabled,
  onSend,
  onClose,
}: {
  draft: string;
  onDraft: (text: string) => void;
  disabled: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const trimmed = draft.trim();
  const left = MAX_TEXT - draft.length;
  const blocked = disabled || !trimmed;
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);
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
          <Icon name="chevronDown" size={20} />
          {t("common.collapse")}
        </button>
        {left <= 200 ? <span className={styles.left}>{t("play.left", { n: left })}</span> : null}
        <span className={styles.sendHint}>
          <Trans i18nKey="play.inputKeys" components={{ kbd: <kbd /> }} />
        </span>
        <button type="button" className={styles.send} disabled={blocked} onClick={() => onSend(trimmed)}>
          <span className={styles.sendIcon}>
            <Icon name="send" size={16} />
          </span>
          {t("play.send")}
        </button>
      </div>
    </div>
  );
}

export function BottomBar({
  state,
  controls,
  writing,
  onWrite,
  onCloseWrite,
  draft,
  onDraft,
  onSend,
  away,
  onJumpToLatest,
  onOpenWorld,
  onOpenMore,
  worldActive,
  moreActive,
  moreRef,
  barRef,
}: {
  state: PlayState;
  controls: PlayControls;
  writing: boolean;
  onWrite: () => void;
  onCloseWrite: () => void;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => void;
  away: boolean;
  onJumpToLatest: () => void;
  onOpenWorld: () => void;
  onOpenMore: () => void;
  /** 世界停靠着：世界按钮显示为选中，再点一次收起 */
  worldActive: boolean;
  /** “更多”菜单开着 */
  moreActive: boolean;
  moreRef: Ref<HTMLButtonElement>;
  barRef: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  if (state.phase === "loading" || state.phase === "load_failed") return null;
  const enabled = canAct(state);
  const live = isLive(state);
  const cancellable = live && state.pending?.turnId != null && state.phase !== "submitting";

  let middle;
  if (live) {
    middle = (
      <>
        <LiveStatus state={state} />
        {cancellable ? (
          <button type="button" className={styles.stop} onClick={controls.cancel}>
            <Icon name="stop" size={16} />
            {t("common.stop")}
          </button>
        ) : null}
      </>
    );
  } else if (state.phase === "syncing") {
    middle = (
      <div className={cx(styles.status, styles.statusMuted)}>
        <Icon name="lock" size={18} />
        <span className={styles.statusText}>{t("play.syncBlocked")}</span>
      </div>
    );
  } else if (isEnded(state)) {
    middle = (
      <div className={cx(styles.status, styles.statusMuted)}>
        <Icon name="flag" size={18} />
        <span className={styles.statusText}>{t("play.ended")}</span>
      </div>
    );
  } else if (needsOpening(state) || state.turns.length === 0) {
    middle = <span className={styles.flex} />;
  } else {
    middle = (
      <button
        type="button"
        className={styles.writePill}
        disabled={!enabled}
        aria-label={draft ? t("play.continueDraft") : t("play.writeOwn")}
        aria-keyshortcuts="/"
        onClick={onWrite}
      >
        <Icon name="write" size={16} />
        <span className={cx(styles.writeText, draft && styles.writeDraft)}>
          {draft || t("play.writeOwnPlaceholder")}
        </span>
        <kbd className={styles.slash}>/</kbd>
      </button>
    );
  }

  const expanded = writing && enabled;
  return (
    <div ref={barRef} className={styles.bar} role="toolbar" aria-label={t("play.toolbar")}>
      <div className={styles.barInner}>
        {expanded ? (
          <FreeInput
            draft={draft}
            onDraft={onDraft}
            disabled={!enabled}
            onSend={onSend}
            onClose={onCloseWrite}
          />
        ) : (
          <div className={styles.barRow}>
            <IconButton
              icon="world"
              label={worldActive ? t("play.worldHide") : t("play.world")}
              aria-keyshortcuts="W"
              diameter={44}
              on={worldActive}
              onClick={onOpenWorld}
            />
            <div className={styles.middle}>
              {middle}
              <div className={cx(styles.jump, away && styles.jumpShown)} aria-hidden={!away}>
                <IconButton
                  icon="down"
                  label={live ? t("play.latestNew") : t("play.latest")}
                  aria-keyshortcuts="End"
                  diameter={44}
                  iconSize={20}
                  badge={live}
                  tabIndex={away ? 0 : -1}
                  onClick={onJumpToLatest}
                />
              </div>
            </div>
            <IconButton
              ref={moreRef}
              icon="more"
              label={t("play.moreLabel")}
              aria-haspopup="dialog"
              aria-expanded={moreActive}
              diameter={44}
              on={moreActive}
              onClick={onOpenMore}
            />
          </div>
        )}
      </div>
    </div>
  );
}
