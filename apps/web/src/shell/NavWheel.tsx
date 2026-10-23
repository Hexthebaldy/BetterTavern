/**
 * 导航轮盘（窗口 ≥ 900，docs/design/comic 的“轮盘”一节；几何和规则的纯函数在 theme/wheel.ts）。
 *
 * - 收起：直径 72 的白圆，中间是 Logo；默认贴着左边、上下居中。
 * - 展开：鼠标在圆上停 120ms 就展开（不用点）；触屏和键盘点一下展开。圆盘半径 178，六块扇区从正上方顺时针：
 *   存档、剧本、角色、工作台、模型、设置。当前页那块墨底；指着的那块蓝网点、往外弹出 14，旁边冒一个说明气泡。
 *   靠边时先把圆心挪到离每条边至少 204 的地方，挪完以后要等鼠标动一下才开始高亮（免得一展开就选中光标底下那块）。
 *   选哪块只看方向：光标离圆心超过内半径就按角度算。
 * - 收起：鼠标离开圆盘 0.3 秒后（中途回来不收）；Esc、点页面别处、进了新页面立刻收起。
 * - 拖动：在圆上按住 0.4 秒拿起来（放大 1.12、投影加深、原地留一个虚线圈），松手停在那里；离左右边 40 以内贴边。
 *   位置存在浏览器里（偏好的 wheel），窗口变了按比例换算再夹回窗口里。
 * - 键盘：Q 打开或收起；展开时 1–6 直接去，方向键在六块之间转，Enter 进去，Esc 收起。
 *   Q 和 1–6 是单键快捷键，跟着设置里的开关走，光标在输入框里时不响应；方向键、Enter、Esc 一直可用。
 * - 无障碍：圆是按钮（aria-haspopup="menu"、aria-expanded），六块是 menu / menuitem，打开时焦点落在当前页那一块。
 *   开了“减少动态效果”时不做弹出和位移的动画（CSS 里的时长变成 0）。
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";

import { Bubble } from "../components/comic.tsx";
import { cx } from "../components/controls.tsx";
import { Icon } from "../components/Icon.tsx";
import { Logo } from "../components/Logo.tsx";
import { useWindowHeight, useWindowWidth } from "../hooks/useWindowSize.ts";
import { usePrefs } from "../state/PrefsProvider.tsx";
import { acceptsSingleKey } from "../theme/layout.ts";
import {
  expandedCenter,
  insideDisc,
  placeHub,
  polar,
  pressOutcome,
  sectorAt,
  sectorPath,
  spotFromPoint,
  stepSector,
  WHEEL,
  type Point,
  type Size,
} from "../theme/wheel.ts";
import { activeIndex, NAV_ITEMS } from "./nav.ts";
import { useWheelCounts } from "./useWheelCounts.ts";
import styles from "./wheel.module.css";

/** 画圆盘的方框（圆心在正中）：圆盘半径 178，加上弹出、投影和外圈的键帽 */
const BOX = 416;
const MID = BOX / 2;
const ARROWS = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"];

type Press = { id: number; type: string; start: Point; at: number; offset: Point; timer: number };
type OpenedBy = "hover" | "tap" | "key";
type BubbleTail = "left" | "right" | "up" | "upRight";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 说明气泡放在哪：右半边的块放在圆盘右边，左半边的放左边；那一边放不下时换到另一边。下半圈的气泡放在下面、尾巴朝上。
 * 返回相对圆盘方框的位置和尾巴的方向。
 */
function bubblePlace(index: number, center: Point, view: Size): { style: CSSProperties; tail: BubbleTail } {
  const a = polar(index, WHEEL.disc + 6);
  const roomRight = view.width - center.x - WHEEL.disc;
  const roomLeft = center.x - WHEEL.disc;
  const natural = index <= 3 ? "right" : "left";
  const right = natural === "right" ? roomRight >= 220 || roomRight >= roomLeft : !(roomLeft >= 220 || roomLeft > roomRight);
  // 再往外让 24，尾巴不压着外圈的键帽
  const x = right ? Math.abs(a.x) + 24 : -Math.abs(a.x) - 24;
  const below = a.y > 0;
  // 尾巴尖离气泡左边（或右边）约 36，离底边（或顶边）约 14
  const left = MID + x + (right ? -36 : 36);
  const top = MID + a.y + (below ? 14 : -14);
  const shiftX = right ? "0" : "-100%";
  const shiftY = below ? "0" : "-100%";
  return {
    style: { left, top, transform: `translate(${shiftX}, ${shiftY})` },
    tail: right ? (below ? "up" : "left") : below ? "upRight" : "right",
  };
}

export function NavWheel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { wheel, setWheel, singleKeys } = usePrefs();
  const width = useWindowWidth();
  const height = useWindowHeight();
  const view = { width, height };
  const hub = placeHub(wheel, view);
  const active = activeIndex(pathname);

  const [open, setOpenState] = useState(false);
  const [center, setCenter] = useState<Point | null>(null);
  const [hovered, setHoveredState] = useState<number | null>(null);
  // 连着按键（Q 紧接着 5、连按方向键）时，下一个键要看到上一个键的结果，所以开关和高亮另记一份，改的时候同步更新
  const openNow = useRef(false);
  const hoveredNow = useRef<number | null>(null);
  const setOpen = useCallback((value: boolean) => {
    openNow.current = value;
    setOpenState(value);
  }, []);
  const setHovered = useCallback((value: number | null) => {
    hoveredNow.current = value;
    setHoveredState(value);
  }, []);
  const [drag, setDrag] = useState<Point | null>(null);
  const [counted, setCounted] = useState(false);
  const counts = useWheelCounts(counted);

  const root = useRef<HTMLElement>(null);
  const hubButton = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const press = useRef<Press | null>(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const armed = useRef(true);
  const armAt = useRef<Point | null>(null);
  const lastPointer = useRef<Point | null>(null);
  const opened = useRef<{ by: OpenedBy; at: number }>({ by: "tap", at: 0 });
  const menuId = useId();
  const patternId = useId();

  // 事件处理里要读最新的值
  const shown = drag ?? (open && center ? center : hub);
  const live = useRef({ hub, shown, active, view });
  live.current = { hub, shown, active, view };

  const clearTimers = (): void => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    openTimer.current = 0;
    closeTimer.current = 0;
  };

  const closeWheel = useCallback(
    (focusHub = false) => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      openTimer.current = 0;
      closeTimer.current = 0;
      setOpen(false);
      setCenter(null);
      setHovered(null);
      if (focusHub) hubButton.current?.focus({ preventScroll: true });
    },
    [setOpen, setHovered],
  );

  const openWheel = useCallback((by: OpenedBy) => {
    const { hub: from, view: size, active: current } = live.current;
    window.clearTimeout(openTimer.current);
    openTimer.current = 0;
    const target = expandedCenter(from, size);
    const moved = target.x !== from.x || target.y !== from.y;
    // 圆心挪过去以后光标底下压着某一块：等鼠标动一下再高亮。键盘打开时也等鼠标真的动了才跟着鼠标走
    // （圆盘出现时浏览器会补发一次坐标不变的 pointermove，不能当成鼠标离开了圆盘）
    armed.current = by === "tap" || (by === "hover" && !moved);
    armAt.current = lastPointer.current;
    opened.current = { by, at: performance.now() };
    setCounted(true);
    setCenter(target);
    setOpen(true);
    setHovered(by === "key" ? (current ?? 0) : null);
  }, [setOpen, setHovered]);

  const go = useCallback(
    (index: number) => {
      const item = NAV_ITEMS[index];
      if (!item) return;
      closeWheel();
      navigate(item.to);
    },
    [closeWheel, navigate],
  );

  // 进了新页面、窗口变了：立刻收起
  useEffect(() => closeWheel(), [pathname, width, height, closeWheel]);
  useEffect(() => clearTimers, []);

  // 一直记着鼠标在哪：展开时拿它判断鼠标是不是真的动了
  useEffect(() => {
    const track = (event: PointerEvent): void => {
      if (event.pointerType === "mouse") lastPointer.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener("pointermove", track, true);
    return () => document.removeEventListener("pointermove", track, true);
  }, []);

  // 键盘打开或用方向键转的时候，焦点跟着那一块走
  useLayoutEffect(() => {
    if (!open || hovered === null || opened.current.by !== "key") return;
    items.current[hovered]?.focus({ preventScroll: true });
  }, [open, hovered]);

  // ---- 展开时：鼠标在圆盘上就高亮指着的那块，离开 0.3 秒收起；点页面别处收起 ----
  useEffect(() => {
    if (!open || !center) return;
    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse" || press.current) return;
      const p = { x: event.clientX, y: event.clientY };
      if (!armed.current) {
        if (armAt.current && distance(p, armAt.current) <= 3) return;
        armed.current = true;
      }
      if (insideDisc(center, p)) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = 0;
        opened.current = { ...opened.current, by: opened.current.by === "key" ? "hover" : opened.current.by };
        setHovered(sectorAt(center, p));
      } else {
        setHovered(null);
        if (!closeTimer.current) closeTimer.current = window.setTimeout(() => closeWheel(), WHEEL.closeDelay);
      }
    };
    const onDown = (event: PointerEvent): void => {
      if (root.current?.contains(event.target as Node)) return;
      closeWheel();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, center, closeWheel, setHovered]);

  // ---- 键盘：Q、1–6（单键快捷键）；方向键、Enter、Esc。捕获阶段先处理，翻页的 ← → 不会同时响应 ----
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const { active: page } = live.current;
      const isOpen = openNow.current;
      const current = hoveredNow.current;
      const inWheel = !!root.current?.contains(document.activeElement);
      if (isOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeWheel(inWheel);
          return;
        }
        if (ARROWS.includes(event.key)) {
          event.preventDefault();
          opened.current = { ...opened.current, by: "key" };
          setHovered(stepSector(current, event.key, page ?? 0));
          return;
        }
        if (event.key === "Enter" && current !== null) {
          event.preventDefault();
          go(current);
          return;
        }
      }
      if (document.querySelector("dialog[open]")) return;
      const single = acceptsSingleKey({
        enabled: singleKeys,
        typing: isTyping(event.target),
        composing: event.isComposing,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      });
      if (!single) return;
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        if (isOpen) closeWheel(inWheel);
        else openWheel("key");
      } else if (isOpen && /^[1-6]$/.test(event.key)) {
        event.preventDefault();
        go(Number(event.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [singleKeys, closeWheel, openWheel, go, setHovered]);

  // ---- 圆：悬停展开、点按、长按拖动 ----
  const lift = (): void => {
    const p = press.current;
    if (!p) return;
    const at = live.current.shown;
    p.offset = { x: p.start.x - at.x, y: p.start.y - at.y };
    closeWheel();
    setDrag(at);
  };

  const finishPress = (event: ReactPointerEvent<HTMLButtonElement>, released: boolean): void => {
    const p = press.current;
    if (!p || p.id !== event.pointerId) return;
    window.clearTimeout(p.timer);
    press.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag) {
      setWheel(spotFromPoint(drag, live.current.view));
      setDrag(null);
      return;
    }
    if (!released) return;
    const now = { x: event.clientX, y: event.clientY };
    const outcome = pressOutcome({ heldMs: performance.now() - p.at, moved: distance(now, p.start), released });
    if (outcome !== "tap") return;
    if (!openNow.current) {
      openWheel("tap");
      return;
    }
    // 鼠标刚停上去展开、紧接着又点了一下：不当成收起
    const justOpened = opened.current.by === "hover" && performance.now() - opened.current.at < 600;
    if (!(p.type === "mouse" && justOpened)) closeWheel();
  };

  const hubStyle = { left: shown.x, top: shown.y } as CSSProperties;
  const place = open && center && hovered !== null ? bubblePlace(hovered, center, view) : null;
  const hoveredItem = hovered !== null ? NAV_ITEMS[hovered] : undefined;
  const hoveredCount = hoveredItem ? counts[hoveredItem.name] : null;

  return (
    <nav ref={root} aria-label={t("nav.main")} className={styles.wheel}>
      {drag ? <span className={styles.ghost} style={{ left: hub.x, top: hub.y }} aria-hidden="true" /> : null}

      {open && center ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("nav.wheel")}
          className={styles.disc}
          style={{ left: center.x - MID, top: center.y - MID }}
          onClick={(event) => {
            const index = sectorAt(center, { x: event.clientX, y: event.clientY });
            if (index !== null) go(index);
          }}
        >
          <svg className={styles.plate} width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true">
            <defs>
              <pattern id={patternId} width="12" height="12" patternUnits="userSpaceOnUse">
                <rect width="12" height="12" className={styles.patternBg} />
                <circle cx="6" cy="6" r="1.6" className={styles.patternDot} />
              </pattern>
            </defs>
            {[1, 2, 3, 4, 5, 6, 7].map((k) => (
              <circle key={k} cx={MID + k} cy={MID + k} r={WHEEL.disc} className={styles.shade} />
            ))}
            <circle cx={MID} cy={MID} r={WHEEL.disc} className={styles.base} />
            {NAV_ITEMS.map((item, i) => {
              if (i === hovered) return null;
              const o = polar(i, WHEEL.gap);
              return (
                <path
                  key={item.name}
                  d={sectorPath(i, MID, MID)}
                  transform={`translate(${o.x} ${o.y})`}
                  className={cx(styles.sector, i === active && styles.sectorOn)}
                />
              );
            })}
            {hovered !== null ? (
              <g
                key={hovered}
                className={styles.hot}
                style={
                  {
                    "--dx": `${polar(hovered, WHEEL.gap + WHEEL.pop).x}px`,
                    "--dy": `${polar(hovered, WHEEL.gap + WHEEL.pop).y}px`,
                  } as CSSProperties
                }
              >
                <path d={sectorPath(hovered, MID, MID)} transform="translate(6 6)" className={styles.hotShadow} />
                <path d={sectorPath(hovered, MID, MID)} fill={`url(#${patternId})`} className={styles.hotFace} />
              </g>
            ) : null}
          </svg>
          {NAV_ITEMS.map((item, i) => {
            const hot = i === hovered;
            const p = polar(i, WHEEL.labelRadius + WHEEL.gap + (hot ? WHEEL.pop : 0));
            const k = polar(i, WHEEL.keyRadius + (hot ? WHEEL.pop : 0));
            const count = counts[item.name];
            const name = t(`nav.${item.name}`);
            return (
              <div key={item.name} className={styles.slot}>
                <div
                  ref={(node) => {
                    items.current[i] = node;
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  aria-current={i === active ? "page" : undefined}
                  aria-keyshortcuts={String(i + 1)}
                  aria-label={count ? `${name} · ${count.long}` : name}
                  className={cx(styles.label, i === active && styles.labelOn, hot && styles.labelHot)}
                  style={{ left: MID + p.x, top: MID + p.y }}
                  onFocus={() => setHovered(i)}
                >
                  <Icon name={item.icon} size={24} strokeWidth={2.2} />
                  <b>{name}</b>
                  {count ? <span className={styles.count}>{count.short}</span> : null}
                </div>
                <span
                  className={cx(styles.num, hot && styles.numHot)}
                  style={{ left: MID + k.x, top: MID + k.y }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
              </div>
            );
          })}
          {place && hoveredItem ? (
            <div className={styles.bubble} style={place.style} aria-hidden="true">
              <Bubble who={t(`nav.${hoveredItem.name}`)} tail={place.tail} small className={styles.bubbleBody}>
                {t(`nav.about.${hoveredItem.name}`)}
                {hoveredCount ? ` · ${hoveredCount.long}` : null}
              </Bubble>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        ref={hubButton}
        type="button"
        className={cx(styles.hub, open && styles.hubOpen, drag && styles.hubLifted)}
        style={hubStyle}
        aria-label={t("nav.wheel")}
        aria-description={t("nav.wheelHint")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-keyshortcuts="Q"
        onPointerEnter={(event) => {
          lastPointer.current = { x: event.clientX, y: event.clientY };
          if (event.pointerType !== "mouse" || openNow.current || drag) return;
          window.clearTimeout(openTimer.current);
          openTimer.current = window.setTimeout(() => openWheel("hover"), WHEEL.openDelay);
        }}
        onPointerLeave={() => {
          if (!openNow.current) {
            window.clearTimeout(openTimer.current);
            openTimer.current = 0;
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          // 按下了就不再算悬停：还没到 120ms 的展开取消掉，免得按住的时候圆跑开
          window.clearTimeout(openTimer.current);
          openTimer.current = 0;
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = { x: event.clientX, y: event.clientY };
          press.current = {
            id: event.pointerId,
            type: event.pointerType,
            start,
            at: performance.now(),
            offset: { x: 0, y: 0 },
            timer: window.setTimeout(lift, WHEEL.hold),
          };
        }}
        onPointerMove={(event) => {
          lastPointer.current = { x: event.clientX, y: event.clientY };
          const p = press.current;
          if (!p || p.id !== event.pointerId) return;
          const now = { x: event.clientX, y: event.clientY };
          if (drag) {
            const r = WHEEL.hub / 2;
            const { width: w, height: h } = live.current.view;
            setDrag({
              x: Math.min(Math.max(now.x - p.offset.x, r), w - r),
              y: Math.min(Math.max(now.y - p.offset.y, r), h - r),
            });
            return;
          }
          const outcome = pressOutcome({
            heldMs: performance.now() - p.at,
            moved: distance(now, p.start),
            released: false,
          });
          if (outcome === "cancel") {
            window.clearTimeout(p.timer);
            press.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerUp={(event) => finishPress(event, true)}
        onPointerCancel={(event) => finishPress(event, false)}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          // 鼠标和触屏的点按在 pointerup 里处理过了；这里只接键盘（Enter、空格）
          if (event.detail !== 0) return;
          if (openNow.current) closeWheel(true);
          else openWheel("key");
        }}
      >
        <Logo size={36} label={null} inverse={open} />
      </button>

      {drag ? (
        <span className={styles.dragTag} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {t("nav.dragging")}
        </span>
      ) : null}
    </nav>
  );
}
