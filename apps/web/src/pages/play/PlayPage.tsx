/**
 * 阅读页（W06–W11）：顶部的书名、故事流、底部固定的操作栏，右边是世界状态。
 * 离开页面只断开连接，服务端的生成继续，回来时会接上。
 *
 * - 三栏：readingLayout(窗口, 收起了侧栏, 世界开着) 决定导航和世界的形态。窗口 − 导航 ≥ 1100 时世界停靠，
 *   阅读栏和底栏在剩下的宽度里重新居中；侧栏展开放不下、收成导航条就放得下时，打开世界让侧栏临时收成导航条；
 *   其余从右侧滑出。停靠的开关记在浏览器里，打开别的故事时保持。
 * - 页面整个滚动（浏览器的查找、滚动条都是原生的）；停在底部时跟着新文字滚，往上翻就停下，
 *   操作栏中间多出“回到最新”；发出行动后回到最新并重新跟随。草稿存在浏览器里，每个故事一份。
 *   自己写的行动没能变成回合（失败后换个行动、故事在别处被推进）时，文字回到输入框并展开。
 * - “停止”：记下点的是哪一轮。服务端停下之前按钮是“正在停止…”；停下后失败卡是灰色的“已停止”；
 *   没停成时浮条说明原因，按钮恢复。
 * - 键盘：A–D 选中选项（高亮，不发出）、Enter 发出选中的那一项、Esc 或点别处取消选中，/ 自己写，W 世界状态，
 *   End 回到最新（单键快捷键可以在快捷键对话框里关掉）。发出行动后焦点放到底栏上，Esc 收起输入框后回到“自己写…”。
 * - 标签页标题：“书名 · BetterTavern”，生成中在前面加“● ”。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { describeError, describeTurnError } from "@bettertavern/core/api/client";
import type { NewAction } from "@bettertavern/core/api/types";
import { readableColumn } from "@bettertavern/design/layout";
import {
  canAct,
  canWrite,
  headTurn,
  isEnded,
  isLive,
  isStopping,
  stoppedByPlayer,
  withReturnedText,
} from "@bettertavern/core/play/turnMachine";

import { Button, IconButton } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { storiesKey } from "../../data/stories.ts";
import { useStoryActions } from "../../data/storyActions.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useShell } from "../../shell/AppShell.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { localStore } from "../../storage/local.ts";
import {
  acceptsSingleKey,
  desktop,
  navMode,
  optionKeyAction,
  readingArea,
  readingLayout,
  shell,
} from "../../theme/layout.ts";
import { BottomBar } from "./BottomBar.tsx";
import { MorePopover, type MoreAction } from "./MorePopover.tsx";
import styles from "./play.module.css";
import { draftKey, nextFollow, parseDraft, type Follow } from "./reading.ts";
import { BookHeader, narrativeVars, StoryFeed } from "./StoryFeed.tsx";
import { TurnActions } from "./TurnActions.tsx";
import { usePlaySession } from "./usePlaySession.ts";
import { WorldPanel } from "./WorldPanel.tsx";

function OpeningSkeleton() {
  const { t } = useTranslation();
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {[100, 100, 100, 58, 0, 100, 100, 74, 0, 100, 40].map((w, i) =>
        w === 0 ? (
          <span key={i} className={styles.skeletonGap} />
        ) : (
          <span key={i} className={styles.skeletonLine} style={{ width: `${w}%` }} />
        ),
      )}
      <div className={styles.opening} role="progressbar" aria-label={t("play.opening")}>
        {t("play.opening")}
      </div>
    </div>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.failed} role="alert">
      <span className={styles.failedIcon}>
        <Icon name="alertCircle" size={28} />
      </span>
      <h2 className={styles.failedTitle}>{t("play.openFailed")}</h2>
      <p className={styles.failedText}>{message}</p>
      <Button label={t("common.reload")} icon="retry" size="lg" className={styles.wide} onClick={onRetry} />
    </div>
  );
}

/** 输入框、文本框、可编辑区域里：单键快捷键不响应 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** 换一个故事就换一页：草稿、输入框、世界面板这些页面里的状态都从头开始 */
export function PlayRoute() {
  const { id = "" } = useParams();
  return <PlayPage key={id} id={id} />;
}

function PlayPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const { api } = useApp();
  const actions = useStoryActions();
  const { reading, worldDocked, setWorldDocked, sidebarCollapsed, singleKeys } = usePrefs();
  const { setNavOverride } = useShell();
  const width = useWindowWidth();
  const controls = usePlaySession(id);
  const { state } = controls;

  // ---- 世界状态：停靠时开关跟着浏览器里的偏好（所有故事共用）；滑出只在这一页里开关 ----
  const dockable = readingLayout(width, sidebarCollapsed, true).world === "dock";
  const [worldOpen, setWorldOpen] = useState(() => dockable && worldDocked);
  const lastDockable = useRef(dockable);
  useEffect(() => {
    // 变宽到可以停靠时，偏好里是开着的就展开；变窄时开着的停靠面板换成滑出的（worldOpen 不变）
    if (!lastDockable.current && dockable && worldDocked) setWorldOpen(true);
    lastDockable.current = dockable;
  }, [dockable, worldDocked]);
  const layout = readingLayout(width, sidebarCollapsed, worldOpen);
  const preferredNav = navMode(width, sidebarCollapsed);
  useEffect(() => {
    setNavOverride(layout.nav !== preferredNav ? layout.nav : null);
  }, [layout.nav, preferredNav, setNavOverride]);
  useEffect(() => () => setNavOverride(null), [setNavOverride]);
  const docked = layout.world === "dock";
  const toggleWorld = useCallback(() => {
    if (dockable) {
      setWorldDocked(!worldOpen);
    }
    setWorldOpen((open) => !open);
  }, [dockable, worldOpen, setWorldDocked]);
  const closeWorld = useCallback(() => {
    setWorldOpen(false);
    if (dockable) setWorldDocked(false);
  }, [dockable, setWorldDocked]);

  // ---- 更多、自己写、草稿 ----
  const moreButton = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [draft, setDraftState] = useState(() => parseDraft(localStore.read(draftKey(id))));
  const setDraft = useCallback(
    (text: string) => {
      setDraftState(text);
      if (text) localStore.write(draftKey(id), text);
      else localStore.remove(draftKey(id));
    },
    [id],
  );

  // 自己写的行动被退回来：放回输入框（已有草稿时放在前面）并展开；故事在别处被推进时再提示一句
  const draftNow = useRef(draft);
  draftNow.current = draft;
  const { takeReturned } = controls;
  useEffect(() => {
    if (!state.returned) return;
    const returned = takeReturned();
    if (!returned) return;
    setDraft(withReturnedText(draftNow.current, returned.text));
    setWriting(true);
    if (returned.why === "stale") overlay.toast(t("play.actionReturned"));
  }, [state.returned, takeReturned, setDraft, overlay, t]);

  // ---- 剧本名和封面（剧本删掉了也不影响阅读） ----
  const scenario = useQuery({
    queryKey: ["scenario", state.scenarioId],
    queryFn: () => api.scenarios.get(state.scenarioId ?? ""),
    enabled: !!state.scenarioId,
    retry: false,
  });
  const [renamed, setRenamed] = useState<string | null>(null);
  const shownTitle = renamed ?? state.title;
  const live = isLive(state);
  useDocumentTitle(shownTitle || t("play.story"), live);

  // 写完一段（或出错）后让故事列表刷新：侧栏的状态和摘要跟着变
  const head = headTurn(state);
  useEffect(() => {
    void queries.invalidateQueries({ queryKey: storiesKey });
  }, [head?.id, live, queries]);

  // ---- 跟随新文字 ----
  const follow = useRef<Follow>({ following: true, lastY: 0 });
  const [away, setAway] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(80);
  useLayoutEffect(() => {
    const node = bar.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBarHeight(Math.round(entry.borderBoxSize[0]?.blockSize ?? node.offsetHeight));
    });
    observer.observe(node);
    return () => observer.disconnect();
  });
  const distance = (): number =>
    document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  useEffect(() => {
    const onScroll = (): void => {
      follow.current = nextFollow(follow.current, { y: window.scrollY, distance: distance() });
      setAway(!follow.current.following);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // 窗口变了（拖动宽度、展开世界）：位置没变也要重新看一眼是不是还在底部
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  const pendingLength = state.pending?.narrative.length ?? 0;
  useLayoutEffect(() => {
    if (follow.current.following) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [state.turns.length, pendingLength, state.phase, barHeight, writing, docked]);
  const jumpToLatest = useCallback(() => {
    follow.current = { following: true, lastY: window.scrollY };
    setAway(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, []);
  // 每次提交（自己写、选项、开场、重试、写结局）之后都回到最新并继续跟随：往上翻着重读时发出的行动也看得到
  const { submit: submitAction, retry: retryTurn } = controls;
  const submit = useCallback(
    (action: NewAction) => {
      submitAction(action);
      jumpToLatest();
    },
    [submitAction, jumpToLatest],
  );
  const retry = useCallback(() => {
    retryTurn();
    jumpToLatest();
  }, [retryTurn, jumpToLatest]);

  // ---- 阅读区的位置（世界停靠时让出右边）----
  const area = readingArea(width, layout.nav, layout.world);
  const column = readableColumn(area.width);
  const frame = {
    ...narrativeVars(reading),
    "--dock": docked ? `${shell.world + shell.edge}px` : "0px",
    "--bar": `${barHeight}px`,
  } as CSSProperties;

  // 发出行动后焦点放到底栏上（输入框、选项按钮都被拿掉了，焦点不能掉到页面上）
  const focusBar = useCallback(() => bar.current?.focus({ preventScroll: true }), []);
  // Esc 或“收起”关掉输入框后，焦点回到“自己写…”
  const writeButton = useRef<HTMLButtonElement>(null);
  const refocusWrite = useRef(false);
  const closeWrite = (): void => {
    setWriting(false);
    refocusWrite.current = true;
  };
  useEffect(() => {
    if (writing || !refocusWrite.current) return;
    refocusWrite.current = false;
    writeButton.current?.focus();
  }, [writing]);

  // 键盘选中的选项（A–D 选中，Enter 才发出）：离开空闲、选项变了、点页面别处都取消
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => setArmed(null), [state.phase, head?.id]);
  useEffect(() => {
    if (armed === null) return;
    const clear = (): void => setArmed(null);
    window.addEventListener("pointerdown", clear);
    return () => window.removeEventListener("pointerdown", clear);
  }, [armed]);

  // 玩家点了“停止”的那一轮（停下前“正在停止…”，停下后失败卡是灰色的“已停止”）；重新加载页面就忘了
  const [stopTurn, setStopTurn] = useState<string | null>(null);
  const stop = (): void => {
    const turnId = state.pending?.turnId;
    if (!turnId) return;
    setStopTurn(turnId);
    // 按钮马上变成禁用的“正在停止…”：焦点放到底栏上，不掉到页面上
    focusBar();
    controls.cancel().catch((e: unknown) => {
      setStopTurn(null);
      overlay.toast(t("play.stopFailed", { error: describeError(e) }), { icon: "alert" });
    });
  };

  const send = (text: string): void => {
    setWriting(false);
    setDraft("");
    submit({ source: "text", text });
    focusBar();
  };
  const pickOption = useCallback(
    (optionId: string) => {
      setWriting(false);
      setArmed(null);
      submit({ source: "option", option_id: optionId });
      focusBar();
    },
    [submit, focusBar],
  );

  const onMore = async (action: MoreAction): Promise<void> => {
    setMoreOpen(false);
    if (action === "world") toggleWorld();
    if (action === "shortcuts") window.dispatchEvent(new CustomEvent("bt:shortcuts"));
    if (action === "delete") {
      await actions.remove({ id, title: shownTitle });
    }
    if (action === "end") {
      // 确认框里可以填想要的方向，也可以不填；写完就不能再继续，也没有撤销
      const wish = await overlay.prompt({
        title: t("play.endTitle"),
        message: t("play.endMessage"),
        label: t("play.endWish"),
        placeholder: t("play.endWishPlaceholder"),
        maxLength: 2000,
        confirmLabel: t("play.writeEnding"),
        optional: true,
        multiline: true,
      });
      if (wish === null) return;
      submit({ source: "ending", text: wish });
    }
    if (action === "rename") {
      const next = await overlay.prompt({
        title: t("stories.renameTitle"),
        label: t("stories.nameLabel"),
        initial: shownTitle,
        maxLength: 80,
      });
      if (!next || next === shownTitle) return;
      try {
        const updated = await api.playthroughs.rename(id, next);
        setRenamed(updated.title);
        void queries.invalidateQueries({ queryKey: storiesKey });
      } catch (e) {
        overlay.toast(t("common.renameFailed", { error: describeError(e) }), { icon: "alert" });
      }
    }
  };

  // ---- 键盘：A–D 选中、Enter 发出、Esc 取消，/、W、End ----
  const { dismissError } = controls;
  const keyState = useRef({ state, writing, moreOpen, armed });
  keyState.current = { state, writing, moreOpen, armed };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const { state: s, writing: w, armed: a } = keyState.current;
      if (event.key === "End" && !isTyping(event.target)) {
        event.preventDefault();
        jumpToLatest();
        return;
      }
      const options = s.phase === "idle" ? (headTurn(s)?.options ?? []) : [];
      if (
        (event.key === "Enter" || event.key === "Escape") &&
        !isTyping(event.target) &&
        !event.isComposing
      ) {
        const action = optionKeyAction(event.key, a, options.length);
        if (action && "send" in action) {
          const option = options[action.send];
          if (!option || !canAct(s)) return;
          event.preventDefault();
          pickOption(option.id);
        } else if (action && "clear" in action) {
          event.preventDefault();
          setArmed(null);
        }
        return;
      }
      const single = acceptsSingleKey({
        enabled: singleKeys,
        typing: isTyping(event.target),
        composing: event.isComposing,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      });
      if (!single) return;
      const action = optionKeyAction(event.key, a, options.length);
      if (action && "arm" in action && canAct(s)) {
        // 只选中，不发出：直接打拼音时以 a–d 开头的字母不会替玩家选了选项
        event.preventDefault();
        setArmed(action.arm);
      } else if (event.key === "/" && canWrite(s) && !w) {
        // 和“自己写…”一样：一轮失败后也能按，等于“换个行动”再展开
        event.preventDefault();
        if (s.phase === "failed") dismissError();
        setWriting(true);
      } else if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        toggleWorld();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [singleKeys, jumpToLatest, toggleWorld, pickOption, dismissError]);

  const top = (
    <div className={styles.top}>
      {layout.nav === "tabbar" ? (
        <IconButton
          icon="back"
          label={t("play.backToSaves")}
          className={styles.back}
          onClick={() => navigate("/playthroughs")}
        />
      ) : null}
      <span className={styles.topTitle}>{shownTitle}</span>
    </div>
  );

  if (state.phase === "loading" || state.phase === "load_failed") {
    return (
      <div className={styles.page} style={frame} data-narr-font={reading.font}>
        {top}
        <div className={styles.feed}>
          {state.phase === "loading" ? (
            <OpeningSkeleton />
          ) : (
            <LoadFailed
              message={state.error ? describeTurnError(state.error) : t("play.loadFailed")}
              onRetry={controls.reload}
            />
          )}
        </div>
      </div>
    );
  }

  const syncing = state.phase === "syncing";
  return (
    <div className={styles.page} style={frame} data-narr-font={reading.font}>
      {top}
      {syncing ? (
        <div className={styles.syncing} role="alert">
          <Icon name="retry" size={16} />
          {t("play.syncing")}
        </div>
      ) : null}
      <div className={styles.feed} style={syncing ? { opacity: 0.4 } : undefined}>
        <StoryFeed
          state={state}
          header={
            <BookHeader
              seed={state.scenarioId ?? id}
              blobId={scenario.data?.avatar_blob_id ?? null}
              title={shownTitle}
              card={scenario.data?.name ?? null}
              protagonist={state.protagonist}
              coverWidth={Math.max(0, column.width + 48 - 24 - 24)}
            />
          }
          footer={
            <TurnActions
              state={state}
              controls={{ ...controls, submit, retry }}
              twoColumns={width >= desktop.rail}
              onOpenSettings={() => navigate("/settings/models")}
              armed={armed}
              onPick={pickOption}
              stopped={stoppedByPlayer(state, stopTurn)}
            />
          }
        />
      </div>
      <BottomBar
        barRef={bar}
        state={state}
        writing={writing}
        onWrite={() => {
          // 失败后点“自己写…”等于“换个行动”：自己写的那段会退回输入框
          if (state.phase === "failed") controls.dismissError();
          setWriting(true);
        }}
        onCloseWrite={closeWrite}
        writeRef={writeButton}
        announcement={
          armed !== null ? t("play.optionArmedLabel", { key: String.fromCharCode(65 + armed) }) : ""
        }
        draft={draft}
        onDraft={setDraft}
        onSend={send}
        away={away}
        stopping={isStopping(state, stopTurn)}
        onStop={stop}
        onJumpToLatest={jumpToLatest}
        onOpenWorld={toggleWorld}
        onOpenMore={() => setMoreOpen((open) => !open)}
        worldActive={docked}
        moreActive={moreOpen}
        moreRef={moreButton}
      />
      {layout.world ? (
        <WorldPanel mode={layout.world} playthroughId={id} version={head?.id ?? null} onClose={closeWorld} />
      ) : null}
      {moreOpen && moreButton.current ? (
        <MorePopover
          anchor={moreButton.current}
          ending={isEnded(state) ? "ended" : canAct(state) ? "ready" : "busy"}
          onClose={() => setMoreOpen(false)}
          onAction={(a) => void onMore(a)}
        />
      ) : null}
    </div>
  );
}
