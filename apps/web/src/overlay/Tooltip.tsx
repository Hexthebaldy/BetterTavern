/**
 * 提示（tooltip）：只给图标按钮和导航条上的封面用。带 data-tip 的元素，鼠标停 500ms 或键盘焦点到达时出现，
 * 墨色胶囊，高 32；有快捷键（data-kbd）时右边带键帽。默认在元素上方 8，上面放不下就放到下方（theme/layout.ts 的 tooltipFrame）。
 * 触屏不出提示。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { timing, tooltipFrame } from "../theme/layout.ts";
import styles from "./overlay.module.css";

type Tip = { anchor: HTMLElement; text: string; kbd: string | null };

function tipOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = (anchor: HTMLElement): void => {
      const text = anchor.dataset.tip;
      if (!text) return;
      setPlace(null);
      setTip({ anchor, text, kbd: anchor.dataset.kbd || null });
    };
    const clear = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = (): void => {
      clear();
      setTip(null);
    };
    const onOver = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      const anchor = tipOf(event.target);
      if (!anchor) return;
      clear();
      timer.current = setTimeout(() => show(anchor), timing.tooltipDelay);
    };
    const onOut = (event: PointerEvent): void => {
      const anchor = tipOf(event.target);
      if (anchor && !anchor.contains(event.relatedTarget as Node | null)) hide();
    };
    const onFocus = (event: FocusEvent): void => {
      const anchor = tipOf(event.target);
      if (anchor && anchor.matches(":focus-visible")) show(anchor);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      clear();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  // 元素被移走（换了页面）就收起
  useEffect(() => {
    if (!tip) return;
    const check = setInterval(() => {
      if (!tip.anchor.isConnected) setTip(null);
    }, 300);
    return () => clearInterval(check);
  }, [tip]);

  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const rect = tip.anchor.getBoundingClientRect();
    const frame = tooltipFrame(
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      { width: box.current.offsetWidth, height: box.current.offsetHeight },
      { width: window.innerWidth },
    );
    setPlace({ left: frame.left, top: frame.top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className={styles.tooltip}
      style={place ? { left: place.left, top: place.top } : { visibility: "hidden", left: 0, top: 0 }}
    >
      {tip.text}
      {tip.kbd ? <kbd className={styles.tipKbd}>{tip.kbd}</kbd> : null}
    </div>,
    document.body,
  );
}
