/**
 * 朗读设置（docs/speech.md）：存在设备上的一个文件里，不和其他偏好一起放钥匙串
 * （多角色的局每个角色的声音加起来可能超过钥匙串一项的大小）。读写失败不打断操作。
 */

import { File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

import { DEFAULT_SPEECH, parseSpeechPrefs, type SpeechPrefs } from "@bettertavern/core/play/speech";

const FILE_NAME = "speech-prefs.json";

let current: SpeechPrefs | null = null;
const listeners = new Set<() => void>();

function read(): SpeechPrefs {
  if (current === null) {
    try {
      const file = new File(Paths.document, FILE_NAME);
      current = file.exists ? parseSpeechPrefs(JSON.parse(file.textSync())) : DEFAULT_SPEECH;
    } catch {
      current = DEFAULT_SPEECH;
    }
  }
  return current;
}

function write(prefs: SpeechPrefs): void {
  current = prefs;
  for (const listener of listeners) listener();
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) file.create({ overwrite: true });
    file.write(JSON.stringify(prefs));
  } catch {
    // 只影响下次打开
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSpeechPrefs(): [SpeechPrefs, (change: (current: SpeechPrefs) => SpeechPrefs) => void] {
  const prefs = useSyncExternalStore(subscribe, read);
  return [prefs, (change) => write(change(read()))];
}
