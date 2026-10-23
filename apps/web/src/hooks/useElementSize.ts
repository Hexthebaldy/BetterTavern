/** 元素的内容宽高（格子里的封面按它画），跟着窗口和格子的变化更新 */

import { useLayoutEffect, useState, type RefObject } from "react";

export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((old) =>
        Math.round(old.width) === Math.round(width) && Math.round(old.height) === Math.round(height)
          ? old
          : { width: Math.round(width), height: Math.round(height) },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
