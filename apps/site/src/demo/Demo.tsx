/**
 * 首屏演示：App 阅读页的样子（里面保持 App 的柔和样式，只有外框是粗边和硬投影）。
 * 段落逐字出现，点 A / B 往下走，两轮后结束；可以改主角名字、切换夜间、“自己写”一句、打开世界看新出现的条目。
 * 故事和推进规则在 story.ts，这里只管计时器和界面状态。
 *
 * 预渲染和 hydrate 时第一段已经写完（initialState），不重新逐字打一遍；从第二段开始逐字出现。
 * 系统打开“减少动态效果”时，每一段直接显示全文。
 */

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Icon, type IconName } from "../components/Icon.tsx";
import { EXTERNAL, WEB_APP } from "../data/links.ts";
import { useCopy } from "../i18n/context.tsx";
import { fill } from "../i18n/format.ts";
import {
  advance,
  choose,
  clampName,
  DRAFT_MAX,
  initialState,
  isEnded,
  optionsOf,
  rename,
  restart,
  seenWorld,
  segments,
  send,
  skip,
  startWriting,
  statusText,
  tick,
  TIMING,
  worldEntries,
  type DemoState,
  type EntityKind,
} from "./story.ts";

const KIND_ICON: Record<EntityKind, IconName> = { person: "person", place: "place", item: "item", fact: "doc" };
const KEYS = ["A", "B"];

/** 标题栏左边的封面（灯塔和浪） */
function Cover() {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" style={{ display: "block" }}>
      <path
        d="M-2 31q5.5-3.6 11 0t11 0 11 0 11 0"
        style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 1.6, strokeLinecap: "round" }}
      />
      <path
        d="M-2 36q5.5-3.6 11 0t11 0 11 0 11 0"
        style={{ fill: "none", stroke: "var(--line2)", strokeWidth: 1.6, strokeLinecap: "round" }}
      />
      <path d="M20 13l4.2 15.5h-8.4z" style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 1.6, strokeLinejoin: "round" }} />
      <circle cx="20" cy="10.2" r="2.6" style={{ fill: "var(--acc)" }} />
    </svg>
  );
}

export function Demo() {
  const { demo: d, hero, story } = useCopy();
  const [s, setS] = useState<DemoState>(() => initialState(story));
  const [dark, setDark] = useState(false);
  const [world, setWorld] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");

  const reduce = useRef(false);
  const feed = useRef<HTMLDivElement>(null);
  // 正文停在最底下时，新写出的字跟着往下滚；读者自己往上翻了就不打扰
  const follow = useRef(true);
  // 按 Esc 取消改名时，输入框消失引起的失焦不算提交
  const cancelName = useRef(false);

  useEffect(() => {
    try {
      reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduce.current = false;
    }
  }, []);

  // 计时器跟着状态走：构思一会儿 → 逐字写 → 点了选项稍等一下进入下一段
  useEffect(() => {
    if (s.phase === "thinking") {
      const t = window.setTimeout(() => setS(startWriting), s.node === "root" ? TIMING.thinkFirst : TIMING.think);
      return () => window.clearTimeout(t);
    }
    if (s.phase === "writing") {
      const t = window.setInterval(() => setS((cur) => tick(cur)), TIMING.tick);
      return () => window.clearInterval(t);
    }
    return undefined;
  }, [s.phase, s.node]);

  useEffect(() => {
    if (s.chosen === null || s.phase !== "idle") return undefined;
    const t = window.setTimeout(() => setS((cur) => advance(cur, reduce.current)), TIMING.afterPick);
    return () => window.clearTimeout(t);
  }, [s.chosen, s.phase]);

  useEffect(() => {
    if (feed.current && follow.current) feed.current.scrollTop = feed.current.scrollHeight;
  });

  const options = optionsOf(s.story, s.node);
  const idle = s.phase === "idle";
  const ended = isEnded(s);
  const hasFresh = s.fresh.length > 0 && !world;

  const doRestart = () => {
    follow.current = true;
    setS((x) => restart(x, reduce.current));
    setWorld(false);
    setComposing(false);
    setDraft("");
  };
  const pick = (i: number) => {
    if (choose(s, i) === s) return;
    follow.current = true;
    setS(choose(s, i));
    setComposing(false);
    setEditing(false);
  };
  const editName = () => {
    cancelName.current = false;
    setDraftName(s.name);
    setEditing(true);
    setComposing(false);
  };
  const commitName = () => {
    if (cancelName.current) return;
    setS((x) => rename(x, draftName));
    setEditing(false);
  };
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelName.current = true;
      setEditing(false);
    }
  };
  const openCompose = () => {
    follow.current = true;
    setComposing(true);
    setEditing(false);
    setWorld(false);
  };
  const sendDraft = () => {
    if (!draft.trim()) return;
    follow.current = true;
    setS((x) => send(x, draft));
    setDraft("");
    setComposing(false);
  };
  const onDraftKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法正在选字时的回车不算发送
    const ime = e.nativeEvent.isComposing || e.keyCode === 229;
    if (e.key === "Enter" && !e.shiftKey && !ime) {
      e.preventDefault();
      sendDraft();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setComposing(false);
    }
  };
  const toggleWorld = () => {
    if (world) {
      setWorld(false);
      setS(seenWorld);
    } else {
      setWorld(true);
      setComposing(false);
      setEditing(false);
    }
  };

  return (
    <section className={dark ? "dm D" : "dm"} aria-label={fill(d.aria, { title: story.title })}>
      <header className="dm-top">
        <span className="dm-cover">
          <Cover />
        </span>
        <div className="dm-ttl">
          <b>{story.title}</b>
          {editing ? (
            <input
              className="me-in"
              type="text"
              aria-label={d.nameAria}
              placeholder={d.namePlaceholder}
              value={draftName}
              onChange={(e) => setDraftName(clampName(story, e.target.value))}
              onKeyDown={onNameKey}
              onBlur={commitName}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
            />
          ) : (
            <button className="me-pill" type="button" onClick={editName} aria-label={fill(d.meAria, { name: s.name })}>
              {fill(d.me, { name: s.name })}
              <Icon name="pencil" />
            </button>
          )}
        </div>
        <button
          className="ib"
          type="button"
          onClick={() => setDark((d) => !d)}
          aria-label={dark ? d.toLight : d.toDark}
          aria-pressed={dark}
        >
          <Icon name={dark ? "sun" : "moon"} />
        </button>
        <button className="ib" type="button" onClick={doRestart} aria-label={d.restart}>
          <Icon name="restart" />
        </button>
      </header>

      <div
        className="dm-feed"
        ref={feed}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {segments(s).map((seg, i) => (
          <Fragment key={i}>
            <p className="narr">
              {seg.text}
              {seg.caret && <span className="caret" aria-hidden="true" />}
            </p>
            {seg.act && (
              <p className="note">
                <span className="sr">{d.myAction}</span>
                {seg.act}
              </p>
            )}
          </Fragment>
        ))}

        {s.typed && (
          <div className="typed appear">
            <p className="note" style={{ margin: 0 }}>
              <span className="sr">{d.myAction}</span>
              {s.typed}
            </p>
            <div className="hint">
              <Icon name="info" size="s" />
              <span>{d.typedHint}</span>
            </div>
          </div>
        )}

        {idle && options && (
          <div className="opts appear" role="group" aria-label={d.optionsAria}>
            {options.map((o, i) => (
              <button
                key={o.label}
                className={s.chosen === i ? "opt on" : "opt"}
                type="button"
                onClick={() => pick(i)}
                disabled={s.chosen !== null}
                aria-label={fill(d.optionAria, { key: KEYS[i]!, label: o.label })}
              >
                <span className="key" aria-hidden="true">
                  {KEYS[i]}
                </span>
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        )}

        {ended && (
          <div className="endc appear">
            <p className="t" style={{ margin: 0 }}>
              {d.endTitle}
            </p>
            <p className="txt" style={{ fontSize: 14.5, lineHeight: "24px" }}>
              {d.endText}
            </p>
            <div className="row">
              <button className="btn pri sm" type="button" onClick={doRestart}>
                {d.restart}
              </button>
              {/* 读完演示，去网页版真的玩一次 */}
              <a className="btn line sm" href={WEB_APP} {...EXTERNAL}>
                {hero.web}
              </a>
            </div>
          </div>
        )}
        <span className="sr" aria-live="polite">
          {s.live}
        </span>
      </div>

      <footer className="dm-bar">
        <button
          className={world ? "tb on" : "tb"}
          type="button"
          onClick={toggleWorld}
          aria-label={world ? d.worldClose : hasFresh ? d.worldFresh : d.world}
          aria-expanded={world}
        >
          <Icon name="compass" style={{ width: 21, height: 21 }} />
          {hasFresh && <span className="bdg" />}
        </button>
        {!idle && (
          <>
            <div className="status">
              <span className="pulse" />
              <span>{statusText(s)}</span>
            </div>
            <button className="ghost" type="button" onClick={() => setS(skip)}>
              {d.showAll}
            </button>
          </>
        )}
        {idle && !ended && !composing && (
          <button className="wpill" type="button" onClick={openCompose}>
            <Icon name="pencil" size="s" />
            <span style={{ flex: 1 }}>{d.writeOwn}</span>
          </button>
        )}
        {composing && (
          <>
            <div className="cmp">
              <textarea
                rows={1}
                aria-label={d.composeAria}
                placeholder={d.composePlaceholder}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, DRAFT_MAX))}
                onKeyDown={onDraftKey}
                autoFocus
              />
              <button className="send" type="button" onClick={sendDraft} disabled={!draft.trim()}>
                {d.send}
              </button>
            </div>
            <button className="ib" type="button" onClick={() => setComposing(false)} aria-label={d.collapse}>
              <Icon name="close" />
            </button>
          </>
        )}
        {ended && (
          <button className="wpill" type="button" onClick={doRestart}>
            <Icon name="restart" size="s" />
            <span style={{ flex: 1 }}>{d.restart}</span>
          </button>
        )}
      </footer>

      {world && (
        <div className="ws" role="dialog" aria-label={d.world}>
          <div className="ws-h">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t">{d.world}</div>
              <div className="s">{d.worldSub}</div>
            </div>
            <button
              className="ib"
              type="button"
              onClick={toggleWorld}
              aria-label={d.worldClose}
              style={{ background: "var(--card)" }}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="ws-l">
            {worldEntries(s).map((e) => (
              <div key={e.id} className={["ent", e.me ? "me" : "", e.fresh ? "fresh" : ""].filter(Boolean).join(" ")}>
                <span className="eic">
                  <Icon name={KIND_ICON[e.kind]} size="s" />
                </span>
                <span className="nm">
                  <b>{e.name}</b>
                  <span>
                    {e.kindLabel} · {e.note}
                  </span>
                </span>
                {e.isNew && <span className="tag new">{d.isNew}</span>}
                {e.isUpd && <span className="tag upd">{d.isUpd}</span>}
              </div>
            ))}
          </div>
          <div className="ws-f">{d.worldFoot}</div>
        </div>
      )}
    </section>
  );
}
