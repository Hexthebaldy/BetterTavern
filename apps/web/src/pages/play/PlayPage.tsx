/**
 * 阅读页（docs/design/comic 的 09）：没有顶栏，页头一行是回合数、存档名、剧本名和主角，右边是“世界 W”“回想 L”和“更多”。
 * 下面三栏：左栏回想，中间一条分镜（StoryFeed），右栏这一话的人物和刚记下的（PlaySides.tsx）；
 * 分镜后面接着选项卡和“自己写”（TurnActions.tsx）；最底下一条提示条写当前能按的键。
 * 窗口窄一些时先收起右栏（< 1200），窄于 900 时只剩中间一栏（没有提示条），顶上多一个返回按钮。
 * 离开页面只断开连接，服务端的生成继续，回来时会接上。
 *
 * - 页面整个滚动（浏览器的查找、滚动条都是原生的）；停在底部时跟着新文字滚，往上翻就停下，右下角出现“回到最新”。
 *   草稿存在浏览器里，每个故事一份。
 * - 键盘：A–D 选选项，/ 自己写，W 世界状态（从右侧滑出），L 回想看全部，End 回到最新（单键快捷键可以在快捷键对话框里关掉）。
 * - 标签页标题：“书名 · BetterTavern”，生成中在前面加“● ”。
 * - 配图（docs/illustrations.md）：每一回合的“画这一幕”打开小框（TurnPicture.tsx），画好的图点开看大图；
 *   删掉画好的图先确认，关掉没画出来的记录不确认。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { describeError, describeTurnError } from "@bettertavern/core/api/client";
import type { CastMember, TurnImage } from "@bettertavern/core/api/types";
import { headTurn, isEnded, isLive, canAct, turnsAfter } from "@bettertavern/core/play/turnMachine";
import { initialOfName } from "@bettertavern/core/scenario/persona";

import { HintBar, Panel, Portrait } from "../../components/comic.tsx";
import { Button, IconButton, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { HeaderTool } from "../../components/PageHeader.tsx";
import { usePersona } from "../../data/personas.ts";
import { storiesKey } from "../../data/stories.ts";
import { useStoryActions } from "../../data/storyActions.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { localStore } from "../../storage/local.ts";
import { acceptsSingleKey, optionIndexForKey, usesWheel, worldMode } from "../../theme/layout.ts";
import { MorePopover, type MoreAction } from "./MorePopover.tsx";
import styles from "./play.module.css";
import { CastColumn, RecapColumn } from "./PlaySides.tsx";
import { draftKey, nextFollow, parseDraft, type Follow } from "./reading.ts";
import { narrativeVars, StoryFeed } from "./StoryFeed.tsx";
import { TurnActions } from "./TurnActions.tsx";
import { DrawDialog, ImageViewer, type PictureActions } from "./TurnPicture.tsx";
import { usePlaySession } from "./usePlaySession.ts";
import { useWorld } from "./useWorld.ts";
import { WorldPanel } from "./WorldPanel.tsx";

function OpeningSkeleton() {
  const { t } = useTranslation();
  return (
    <Panel tone="grey" className={styles.skeleton} aria-hidden="true">
      {[100, 100, 100, 58, 0, 100, 100, 74].map((w, i) =>
        w === 0 ? (
          <span key={i} className={styles.skeletonGap} />
        ) : (
          <span key={i} className={styles.skeletonLine} style={{ width: `${w}%` }} />
        ),
      )}
      <div className={styles.opening} role="progressbar" aria-label={t("play.opening")}>
        {t("play.opening")}
      </div>
    </Panel>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel tone="dots" hot className={styles.failed} role="alert">
      <Icon name="alertCircle" size={28} />
      <h2 className={styles.failedTitle}>{t("play.openFailed")}</h2>
      <p className={styles.failedText}>{message}</p>
      <Button label={t("common.reload")} icon="retry" onClick={onRetry} />
    </Panel>
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
  const { reading, singleKeys } = usePrefs();
  const width = useWindowWidth();
  const wide = usesWheel(width);
  const controls = usePlaySession(id);
  const { state } = controls;
  // “回到这里”的处理函数要稳定（故事流里每一段都是 memo 的），所以经 ref 读最新的状态
  const stateRef = useRef(state);
  stateRef.current = state;
  const { rollback } = controls;
  const rollbackTo = useCallback(
    async (turnId: string) => {
      const current = stateRef.current;
      const left = t("play.rollbackLeft", { count: Math.max(current.rollbacksLeft - 1, 0) });
      const ok = await overlay.confirm({
        title: t("play.rollbackTitle"),
        message: t("play.rollbackMessage", { count: turnsAfter(current, turnId), left }),
        confirmLabel: t("play.rollbackHere"),
        tone: "warn",
        icon: "back",
      });
      if (!ok) return;
      const failure = await rollback(turnId);
      if (failure) {
        overlay.toast(t("play.rollbackFailed", { error: describeTurnError(failure) }), { icon: "alert" });
        return;
      }
      overlay.toast(t("play.rolledBack"));
      void queries.invalidateQueries({ queryKey: storiesKey });
    },
    [overlay, t, rollback, queries],
  );

  // ---- 配图：画这一幕的小框、看大图；故事流里每一段是 memo 的，操作要稳定 ----
  const [drawFor, setDrawFor] = useState<{ turnId: string; request: string } | null>(null);
  const [viewing, setViewing] = useState<TurnImage | null>(null);
  const { drawImage, removeImage } = controls;
  const pictures = useMemo<PictureActions>(
    () => ({
      draw: (turnId, request = "") => setDrawFor({ turnId, request }),
      retry: (image) => {
        void drawImage(image.turn_id, { request: image.request, style: image.style }).then((failure) => {
          if (failure)
            overlay.toast(t("play.drawFailed", { error: describeTurnError(failure) }), { icon: "alert" });
        });
      },
      remove: (image) => {
        void (async () => {
          if (image.status === "ready") {
            const ok = await overlay.confirm({
              title: t("play.imageDeleteTitle"),
              message: t("play.imageDeleteMessage"),
              confirmLabel: t("play.imageDelete"),
              tone: "danger",
              icon: "trash",
            });
            if (!ok) return;
          }
          const failure = await removeImage(image.turn_id, image.id);
          if (failure)
            overlay.toast(t("play.imageDeleteFailed", { error: describeTurnError(failure) }), {
              icon: "alert",
            });
        })();
      },
      open: setViewing,
    }),
    [drawImage, removeImage, overlay, t],
  );

  // ---- 世界状态：从右侧滑出（手机宽度是底部面板），只在这一页里开关；右栏的人物和刚记下的也取它。
  // 闪电模式没有世界状态：不取，也不显示“世界”按钮、W 键和右栏 ----
  const lightning = state.mode === "lightning";
  const [worldOpen, setWorldOpen] = useState(false);
  const toggleWorld = useCallback(() => setWorldOpen((open) => !open), []);
  const closeWorld = useCallback(() => setWorldOpen(false), []);
  const head = headTurn(state);
  const world = useWorld(id, { version: head?.id ?? null, headSeq: head?.seq ?? null, enabled: !lightning });

  // ---- 回想：默认最近几段，L 看全部 ----
  const [recapAll, setRecapAll] = useState(false);
  const toggleRecap = useCallback(() => setRecapAll((all) => !all), []);

  // ---- 更多、自己写、草稿 ----
  const moreButton = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  // 多角色的局点了名的人（按点的顺序，旁白是 null）：交了行动就清掉
  const [speakers, setSpeakers] = useState<(number | null)[]>([]);
  const toggleSpeaker = (speaker: number | null): void =>
    setSpeakers((now) => (now.includes(speaker) ? now.filter((s) => s !== speaker) : [...now, speaker]));
  const { setMuted } = controls;
  const mute = async (member: CastMember): Promise<void> => {
    if (!member.muted) setSpeakers((now) => now.filter((s) => s !== member.position));
    const failure = await setMuted(member.position, !member.muted);
    if (failure)
      overlay.toast(t("play.castMuteFailed", { error: describeTurnError(failure) }), { icon: "alert" });
  };
  const [draft, setDraftState] = useState(() => parseDraft(localStore.read(draftKey(id))));
  const setDraft = useCallback(
    (text: string) => {
      setDraftState(text);
      if (text) localStore.write(draftKey(id), text);
      else localStore.remove(draftKey(id));
    },
    [id],
  );

  // ---- 剧本名（剧本删掉了也不影响阅读） ----
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

  // 写完一段（或出错）后让故事列表刷新：存档页的状态和摘要跟着变
  useEffect(() => {
    void queries.invalidateQueries({ queryKey: storiesKey });
  }, [head?.id, live, queries]);

  // ---- 跟随新文字 ----
  const follow = useRef<Follow>({ following: true, lastY: 0 });
  const [away, setAway] = useState(false);
  const distance = (): number =>
    document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  useEffect(() => {
    const onScroll = (): void => {
      follow.current = nextFollow(follow.current, { y: window.scrollY, distance: distance() });
      setAway(!follow.current.following);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // 窗口变了（拖动宽度）：位置没变也要重新看一眼是不是还在底部
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  const pendingLength = state.pending?.narrative.length ?? 0;
  useLayoutEffect(() => {
    if (follow.current.following) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [state.turns.length, pendingLength, state.phase, writing]);
  const jumpToLatest = useCallback(() => {
    follow.current = { following: true, lastY: window.scrollY };
    setAway(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, []);

  const frame = narrativeVars(reading) as CSSProperties;

  const send = (text: string): void => {
    setWriting(false);
    setDraft("");
    setSpeakers([]);
    controls.submit({ source: "text", text, ...(speakers.length > 0 ? { speakers } : {}) });
  };

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
      });
      if (wish === null) return;
      controls.submit({ source: "ending", text: wish });
      jumpToLatest();
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

  // ---- 键盘：A–D、/、W、L、End ----
  const keyState = useRef({ state, writing });
  keyState.current = { state, writing };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const { state: s, writing: w } = keyState.current;
      if (event.key === "End" && !isTyping(event.target)) {
        event.preventDefault();
        jumpToLatest();
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
      const options = s.phase === "idle" ? (headTurn(s)?.options ?? []) : [];
      const index = optionIndexForKey(event.key, options.length);
      if (index !== null && canAct(s)) {
        const option = options[index];
        if (!option) return;
        event.preventDefault();
        setWriting(false);
        controls.submit({ source: "option", option_id: option.id });
      } else if (event.key === "/" && canAct(s) && s.turns.length > 0 && !w) {
        event.preventDefault();
        setWriting(true);
      } else if (event.key.toLowerCase() === "w" && !lightning) {
        event.preventDefault();
        toggleWorld();
      } else if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        toggleRecap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [singleKeys, controls, jumpToLatest, toggleWorld, toggleRecap, lightning]);

  // 开局时用的人设：页头“我是 林川”前面放它的头像（docs/personas.md 第 5、7 节：阅读页只在这里放）
  const persona = usePersona(state.personaId);
  const sub = [scenario.data?.name, state.protagonist ? t("play.iAm", { name: state.protagonist }) : null]
    .filter(Boolean)
    .join(" · ");
  const header = (
    <header className={styles.head}>
      {!wide ? (
        <IconButton
          icon="back"
          label={t("play.backToSaves")}
          tone="plain"
          className={styles.back}
          onClick={() => navigate("/playthroughs")}
        />
      ) : null}
      {head && head.seq > 0 ? (
        <Pill tone="acc" label={t("play.turnChip", { n: head.seq })} className={styles.turnChip} />
      ) : null}
      <h1 className={styles.title}>{shownTitle}</h1>
      {sub ? (
        <span className={styles.sub}>
          {persona ? (
            <Portrait
              name={persona.name}
              seed={persona.id}
              glyph={initialOfName(persona.name)}
              blobId={persona.avatar_blob_id}
              size={24}
              radius={12}
              className={styles.subAvatar}
            />
          ) : null}
          <span className={styles.subText}>{sub}</span>
        </span>
      ) : null}
      <div className={styles.tools} role="toolbar" aria-label={t("play.toolbar")}>
        {lightning ? null : (
          <HeaderTool
            icon="world"
            label={t("play.worldShort")}
            kbd={wide ? "W" : undefined}
            aria-keyshortcuts="W"
            active={worldOpen}
            onClick={toggleWorld}
          />
        )}
        {wide && state.turns.length > 5 ? (
          <HeaderTool
            icon="history"
            label={t("play.recap.short")}
            kbd="L"
            aria-keyshortcuts="L"
            active={recapAll}
            onClick={toggleRecap}
          />
        ) : null}
        <IconButton
          ref={moreButton}
          icon="more"
          label={t("play.moreLabel")}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          tone="card"
          on={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        />
      </div>
    </header>
  );

  const loading = state.phase === "loading" || state.phase === "load_failed";
  const syncing = state.phase === "syncing";
  const hints = [
    { keys: ["A", "B", "C"], label: t("play.hints.pick") },
    { keys: ["/"], label: t("play.hints.write") },
    { keys: ["L"], label: t("play.hints.recap") },
    ...(lightning ? [] : [{ keys: ["W"], label: t("play.hints.world") }]),
    { keys: ["End"], label: t("play.hints.latest") },
    { keys: ["Q"], label: t("play.hints.wheel") },
  ];

  return (
    <div className={styles.page} style={frame} data-narr-font={reading.font} data-wide={wide || undefined}>
      {header}
      {syncing ? (
        <div className={styles.syncing} role="alert">
          <Icon name="retry" size={16} />
          {t("play.syncing")}
        </div>
      ) : null}
      <div className={styles.layout}>
        <RecapColumn turns={state.turns} all={recapAll} onToggle={toggleRecap} />
        <div className={styles.strip} style={syncing ? { opacity: 0.4 } : undefined}>
          {loading ? (
            state.phase === "loading" ? (
              <OpeningSkeleton />
            ) : (
              <LoadFailed
                message={state.error ? describeTurnError(state.error) : t("play.loadFailed")}
                onRetry={controls.reload}
              />
            )
          ) : (
            <StoryFeed
              state={state}
              onRollback={rollbackTo}
              pictures={pictures}
              footer={
                <TurnActions
                  state={state}
                  controls={controls}
                  onOpenSettings={() => navigate("/models")}
                  onPicked={() => {
                    setWriting(false);
                    setSpeakers([]);
                  }}
                  writing={writing}
                  draft={draft}
                  onDraft={setDraft}
                  onWrite={() => setWriting(true)}
                  onCloseWrite={() => setWriting(false)}
                  onSend={send}
                  speakers={speakers}
                  onToggleSpeaker={toggleSpeaker}
                  onClearSpeakers={() => setSpeakers([])}
                  onMute={(member) => void mute(member)}
                />
              }
            />
          )}
        </div>
        {lightning ? null : <CastColumn view={world.query.data} onOpenWorld={() => setWorldOpen(true)} />}
      </div>
      <div className={styles.jump} data-shown={away || undefined} aria-hidden={!away}>
        <IconButton
          icon="down"
          label={live ? t("play.latestNew") : t("play.latest")}
          aria-keyshortcuts="End"
          tone="card"
          diameter={48}
          iconSize={20}
          badge={live}
          tabIndex={away ? 0 : -1}
          onClick={jumpToLatest}
        />
      </div>
      {wide ? <HintBar items={hints} label={t("play.hints.label")} /> : null}
      {worldOpen ? (
        <WorldPanel
          mode={worldMode(width)}
          playthroughId={id}
          version={head?.id ?? null}
          headSeq={head?.seq ?? null}
          onClose={closeWorld}
        />
      ) : null}
      {drawFor ? (
        <DrawDialog
          initialRequest={drawFor.request}
          initialStyle={state.imageStyle}
          onDraw={(body) => drawImage(drawFor.turnId, body)}
          onOpenSettings={() => navigate("/settings/tools")}
          onClose={() => setDrawFor(null)}
        />
      ) : null}
      {viewing ? <ImageViewer image={viewing} onClose={() => setViewing(null)} /> : null}
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
