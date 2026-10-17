/**
 * 导航里滑动的玻璃框（侧栏、导航条、底部 Tab 栏共用，同 App 的 components/bars.tsx）：
 * 量出选中项相对导航容器的位置和大小，选中项变了就用 CSS 过渡滑过去；第一次放上去、窗口或侧栏尺寸变化时直接放到位。
 * 玻璃框没有底色，只有一圈半透明的蓝色描边和高光（--tab-glass-edge、--tab-glass-shadow）。
 * 用法：容器 position: relative（或 fixed），把 glass 放在第一个子元素，每一项用 ref(key) 挂上。
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "../components/controls.tsx";
import styles from "./shell.module.css";

type Box = { x: number; y: number; w: number; h: number };

function same(a: Box | null, b: Box): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function useGlass(activeKey: string | null): {
  ref: (key: string) => (el: HTMLElement | null) => void;
  glass: ReactNode;
} {
  const items = useRef(new Map<string, HTMLElement>());
  const [box, setBox] = useState<Box | null>(null);
  const [slide, setSlide] = useState(false);
  const shown = useRef<{ key: string; box: Box } | null>(null);

  useLayoutEffect(() => {
    const el = activeKey ? items.current.get(activeKey) : undefined;
    if (!activeKey || !el) {
      shown.current = null;
      setBox(null);
      return;
    }
    const measure = (): Box => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    const next = measure();
    // 换了选中项才滑；第一次放上去直接到位
    setSlide(!!shown.current && shown.current.key !== activeKey);
    setBox(next);
    shown.current = { key: activeKey, box: next };
    // 尺寸变了（窗口缩放、侧栏展开）直接放到位；ResizeObserver 一开始会回调一次，位置没变就不管
    const observer = new ResizeObserver(() => {
      const now = measure();
      if (same(shown.current?.box ?? null, now)) return;
      shown.current = { key: activeKey, box: now };
      setSlide(false);
      setBox(now);
    });
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [activeKey]);

  return {
    ref: (key) => (el) => {
      if (el) items.current.set(key, el);
      else items.current.delete(key);
    },
    glass: box ? (
      <span
        aria-hidden="true"
        className={cx(styles.glass, slide && styles.glassSlide)}
        style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
      />
    ) : null,
  };
}
