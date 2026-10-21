/** 文档只有中文：英文、日文页上指向文档的链接后面跟一句小字说明（文案的 docsLangNote，中文页是空的） */

import { useCopy } from "../i18n/context.tsx";

export function DocNote() {
  const { docsLangNote } = useCopy();
  return docsLangNote ? <span className="dl-note">{docsLangNote}</span> : null;
}
