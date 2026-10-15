/** 窗口宽高：拖动窗口时布局即时切换（只看宽度，不判断设备） */

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}

export function useWindowHeight(): number {
  return useSyncExternalStore(subscribe, () => window.innerHeight);
}
