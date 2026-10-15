/** 元素的内容宽度（剧本网格按它算列数），跟着窗口和侧栏的变化更新 */

import { useLayoutEffect, useState, type RefObject } from "react";

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
