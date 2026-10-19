/**
 * 阅读页“自己写”的草稿，每个故事一份，存在手机上（storage/drafts.ts）：
 * 进页面先读回；输入停 500ms 再写；清空时立刻删掉这一条；离开页面、App 退到后台时把没写的立刻写掉。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { loadDraft, saveDraft } from "../../storage/drafts.ts";

const SAVE_DELAY_MS = 500;

export function useDraft(playthroughId: string): [string, (text: string) => void] {
  const [draft, setDraftState] = useState("");
  const latest = useRef("");
  // 读回之前已经打过字：不拿存着的覆盖
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void loadDraft(playthroughId).then((saved) => {
      if (!alive || !saved || touched.current) return;
      latest.current = saved;
      setDraftState(saved);
    });
    return () => {
      alive = false;
    };
  }, [playthroughId]);

  const flush = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    void saveDraft(playthroughId, latest.current);
  }, [playthroughId]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  const setDraft = useCallback(
    (text: string) => {
      touched.current = true;
      latest.current = text;
      setDraftState(text);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (!text) {
        void saveDraft(playthroughId, "");
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        void saveDraft(playthroughId, latest.current);
      }, SAVE_DELAY_MS);
    },
    [playthroughId],
  );

  return [draft, setDraft];
}
