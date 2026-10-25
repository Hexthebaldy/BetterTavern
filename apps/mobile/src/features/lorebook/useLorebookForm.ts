/**
 * 世界书详情里编辑条目的状态和自动保存（和网页端的 pages/lorebook/useLorebookForm.ts 同一套逻辑）：
 * - 条目从详情读出来（cardEdit 的 entryDraftOf），每次修改 800 毫秒后自动保存整本（PUT …/book，带读到的版本号）；
 *   保存过程中又改了，存完再存一次；
 * - 改名、改简介也会让版本号加 1：条目没变就只记下新版本号；
 * - 版本号对不上（409 LOREBOOK_CHANGED，别的设备改过）：换成最新的内容并提示；
 * - 离开页面时还有没存的马上存。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { LorebookDetail } from "@bettertavern/core/api/types";
import { entryDraftOf, entryInput, type EntryDraft } from "@bettertavern/core/scenario/cardEdit";

import { useOverlay } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import type { AutosaveStatus } from "../workbench/useCardForm.ts";

const DEBOUNCE_MS = 800;

function sameBook(a: readonly EntryDraft[], b: readonly EntryDraft[]): boolean {
  return JSON.stringify(a.map(entryInput)) === JSON.stringify(b.map(entryInput));
}

export type LorebookForm = {
  book: EntryDraft[] | null;
  update: (book: EntryDraft[]) => void;
  status: AutosaveStatus;
  /** 服务端拒绝时（超过上限）指出的字段，比如 book.3.content */
  serverField: string | null;
};

/** onSaved：存好以后把新的详情交回去（页面上的数字、名字跟着变） */
export function useLorebookForm(
  id: string,
  detail: LorebookDetail | undefined,
  onSaved: (detail: LorebookDetail) => void,
): LorebookForm {
  const { api } = useApp();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const [book, setBook] = useState<EntryDraft[] | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>({ kind: "idle" });
  const [serverField, setServerField] = useState<string | null>(null);
  const synced = useRef<{ version: number; book: EntryDraft[] } | null>(null);
  const bookRef = useRef<EntryDraft[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;
  bookRef.current = book;

  const adopt = useCallback((next: LorebookDetail): void => {
    const fresh = next.book.map(entryDraftOf);
    synced.current = { version: next.lorebook.version, book: fresh };
    setBook(fresh);
  }, []);

  useEffect(() => {
    if (!detail) return;
    const base = synced.current;
    if (!base) {
      adopt(detail);
      return;
    }
    if (detail.lorebook.version <= base.version) return;
    const fresh = detail.book.map(entryDraftOf);
    if (sameBook(base.book, fresh)) {
      synced.current = { version: detail.lorebook.version, book: base.book };
    } else if (!bookRef.current || sameBook(base.book, bookRef.current)) {
      adopt(detail);
    }
  }, [adopt, detail]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    const base = synced.current;
    const current = bookRef.current;
    if (!base || !current || sameBook(base.book, current)) {
      setStatus((s) => (s.kind === "pending" ? { kind: "saved" } : s));
      return true;
    }
    const run = (async (): Promise<boolean> => {
      setStatus({ kind: "saving" });
      try {
        const next = await api.lorebooks.saveBook(id, base.version, current.map(entryInput));
        synced.current = { version: next.lorebook.version, book: current };
        savedRef.current(next);
        setServerField(null);
        setStatus({ kind: "saved" });
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === "LOREBOOK_CHANGED") {
          try {
            const latest = await api.lorebooks.get(id);
            adopt(latest);
            savedRef.current(latest);
            setStatus({ kind: "saved" });
            overlay.toast(t("errors.api.LOREBOOK_CHANGED"), { icon: "info" });
          } catch (again) {
            setStatus({ kind: "failed", error: describeError(again) });
          }
          return false;
        }
        if (e instanceof ApiError) {
          const field = e.field("field");
          setServerField(typeof field === "string" ? field : null);
        }
        setStatus({ kind: "failed", error: describeError(e) });
        return false;
      }
    })();
    inflight.current = run;
    let ok = false;
    try {
      ok = await run;
    } finally {
      inflight.current = null;
    }
    const after = synced.current;
    if (ok && after && bookRef.current && !sameBook(after.book, bookRef.current)) {
      setStatus({ kind: "pending" });
      timer.current = setTimeout(() => void saveNow(), DEBOUNCE_MS);
    }
    return ok;
  }, [adopt, api, id, overlay, t]);

  const update = useCallback(
    (next: EntryDraft[]) => {
      setBook(next);
      setStatus({ kind: "pending" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNow(), DEBOUNCE_MS);
    },
    [saveNow],
  );

  const latestSave = useRef(saveNow);
  latestSave.current = saveNow;
  useEffect(
    () => () => {
      if (timer.current) void latestSave.current();
    },
    [],
  );

  return { book, update, status, serverField };
}
