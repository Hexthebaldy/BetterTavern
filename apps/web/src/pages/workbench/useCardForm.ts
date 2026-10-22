/**
 * 手动表单的状态和自动保存（同 App 的 src/features/workbench/useCardForm.ts）：
 * - 表单从草稿读出来（@bettertavern/core/scenario/cardEdit 的 draftFrom），每次修改 800 毫秒后自动保存
 *   （PUT …/card，带上读到的版本号）；保存过程中又改了，存完再存一次；
 * - 草稿在服务端变了（agent 写了、别的设备改了、换了封面）：内容和表单的底稿一样就只记下新版本号；
 *   表单没改过就换成新内容；表单也改过，下次保存会是 409 DRAFT_CHANGED，这时换成最新的内容并提示；
 * - 离开页面、切到 agent、保存进仓库之前先把没存的存掉（flush）；关标签页时还有没存的由浏览器提示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import { checkCard, draftFrom, isDirty, toInput, type CardDraft } from "@bettertavern/core/scenario/cardEdit";

import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import type { DraftSession } from "./useDraftSession.ts";

const DEBOUNCE_MS = 800;

export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; error: string };

export type CardForm = {
  form: CardDraft | null;
  update: (patch: Partial<CardDraft>) => void;
  status: AutosaveStatus;
  /** 立刻把没存的存掉；存不上时返回 false */
  flush: () => Promise<boolean>;
  issues: ReturnType<typeof checkCard>;
};

export function useCardForm(draftId: string, session: DraftSession): CardForm {
  const { api } = useApp();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const draft = session.state?.draft ?? null;
  const setDraft = session.setDraft;
  const [form, setForm] = useState<CardDraft | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>({ kind: "idle" });
  // 服务端那一版：版本号和它对应的表单内容（用来判断“改过没有”）
  const synced = useRef<{ version: number; form: CardDraft } | null>(null);
  const formRef = useRef<CardDraft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  formRef.current = form;

  // 草稿在服务端变了
  useEffect(() => {
    if (!draft) return;
    const base = synced.current;
    const version = draft.draft.version;
    if (!base) {
      const fresh = draftFrom(draft);
      synced.current = { version, form: fresh };
      setForm(fresh);
      return;
    }
    if (version <= base.version) return;
    const fresh = draftFrom(draft);
    if (!isDirty(base.form, fresh)) {
      // 内容没变（换封面、切模式）：只换版本号
      synced.current = { version, form: base.form };
    } else if (!formRef.current || !isDirty(base.form, formRef.current)) {
      synced.current = { version, form: fresh };
      setForm(fresh);
    }
    // 两边都改了：留着用户的修改，下次保存是 409，那时换成最新的
  }, [draft]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    const base = synced.current;
    const current = formRef.current;
    if (!base || !current || !isDirty(base.form, current)) {
      setStatus((s) => (s.kind === "pending" ? { kind: "saved" } : s));
      return true;
    }
    const run = (async (): Promise<boolean> => {
      setStatus({ kind: "saving" });
      const { name, card } = toInput(current);
      try {
        const next = await api.workbench.saveCard(draftId, base.version, name, card);
        synced.current = { version: next.draft.version, form: current };
        setDraft(next);
        setStatus({ kind: "saved" });
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === "DRAFT_CHANGED") {
          try {
            const latest = await api.workbench.get(draftId);
            const fresh = draftFrom(latest);
            synced.current = { version: latest.draft.version, form: fresh };
            setForm(fresh);
            setDraft(latest);
            setStatus({ kind: "saved" });
            overlay.toast(t("workbench.header.draftChanged"), { icon: "info" });
            return false;
          } catch (again) {
            setStatus({ kind: "failed", error: describeError(again) });
            return false;
          }
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
    // 存的时候又改了：接着存
    const after = synced.current;
    if (ok && after && formRef.current && isDirty(after.form, formRef.current)) {
      setStatus({ kind: "pending" });
      timer.current = setTimeout(() => void saveNow(), DEBOUNCE_MS);
    }
    return ok;
  }, [api, draftId, overlay, setDraft, t]);

  const update = useCallback(
    (patch: Partial<CardDraft>) => {
      setForm((f) => (f ? { ...f, ...patch } : f));
      setStatus({ kind: "pending" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNow(), DEBOUNCE_MS);
    },
    [saveNow],
  );

  // 离开页面：没存的马上存
  const latestSave = useRef(saveNow);
  latestSave.current = saveNow;
  useEffect(
    () => () => {
      if (timer.current) void latestSave.current();
    },
    [],
  );

  // 关标签页、刷新：还有没存的就让浏览器提示
  const unsaved = status.kind === "pending" || status.kind === "saving";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const issues = useMemo(() => (form ? checkCard(form) : []), [form]);
  return { form, update, status, flush: saveNow, issues };
}
