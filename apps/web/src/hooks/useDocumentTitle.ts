/**
 * 标签页标题：“页面名 · BetterTavern”；阅读页生成中在前面加“● ”（theme/layout.ts 的 documentTitle）。
 * 传 null 表示这一层不管标题（嵌在别的页面里时，由外面那一层设）。
 */

import { useEffect } from "react";

import { documentTitle } from "../theme/layout.ts";

export function useDocumentTitle(title: string | null, generating = false): void {
  useEffect(() => {
    if (title !== null) document.title = documentTitle(title, generating);
  }, [title, generating]);
}
