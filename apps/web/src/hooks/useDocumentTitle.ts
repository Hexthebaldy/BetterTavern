/** 标签页标题：“页面名 · BetterTavern”；阅读页生成中在前面加“● ”（theme/layout.ts 的 documentTitle） */

import { useEffect } from "react";

import { documentTitle } from "../theme/layout.ts";

export function useDocumentTitle(title: string | null, generating = false): void {
  useEffect(() => {
    document.title = documentTitle(title, generating);
  }, [title, generating]);
}
