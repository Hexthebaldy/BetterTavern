/**
 * 阅读页的草稿：每个故事一份，存在 App 文档目录的 drafts.json（{ 故事 ID: 文字 }），
 * 回到存档列表、App 被系统收掉都不丢。不放 SecureStore：单个值有大小上限，2000 个汉字放不下。
 * 读写失败不影响阅读，只是这次没存上。
 */

import { File, Paths } from "expo-file-system";

const FILE_NAME = "drafts.json";

let cache: Record<string, string> | null = null;

function draftsFile(): File {
  return new File(Paths.document, FILE_NAME);
}

function parse(raw: string): Record<string, string> {
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const drafts: Record<string, string> = {};
  for (const [id, text] of Object.entries(data)) {
    if (typeof text === "string" && text) drafts[id] = text;
  }
  return drafts;
}

async function readAll(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const file = draftsFile();
    cache = file.exists ? parse(await file.text()) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export async function loadDraft(playthroughId: string): Promise<string> {
  return (await readAll())[playthroughId] ?? "";
}

/** 写入这个故事的草稿；空字符串表示删掉这一条 */
export async function saveDraft(playthroughId: string, text: string): Promise<void> {
  const drafts = { ...(await readAll()) };
  if (text) drafts[playthroughId] = text;
  else delete drafts[playthroughId];
  cache = drafts;
  try {
    const file = draftsFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(drafts));
  } catch {
    // 写不进去就算了
  }
}
