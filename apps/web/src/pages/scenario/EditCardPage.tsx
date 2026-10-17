/**
 * 编辑角色卡（同 App 的 app/scenario/[id]/edit.tsx）：剧本名、角色名、标签；描述、性格；情境、开场白；对话示例；
 * 卡片自带的世界书（BookEditor.tsx）。单栏，最宽 640，居中；顶上一条（返回、标题、保存）滚动时贴在顶上。
 * - 顶上说明：修改只影响之后开始的新故事；{{user}} 会换成主角的名字，{{char}} 会换成角色名。
 * - 保存前先按和服务端相同的规则检查（@bettertavern/core/scenario/cardEdit），不合格的字段标红；之后每次修改都重新检查，
 *   改好的字段马上恢复。
 * - 保存带版本号：别处改过（409 CARD_CHANGED）时提示重新加载；保存成功回到剧本详情。
 * - 有没保存的修改时：站内跳转先问“放弃修改？”（路由的 blocker），刷新或关标签页由浏览器提示（beforeunload）。
 * - 页底“恢复导入时的内容”，要确认。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useLocation, useNavigate, useParams } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { ScenarioCard } from "@bettertavern/core/api/types";
import {
  CARD_LIMITS,
  charCount,
  checkDraft,
  describeField,
  draftFrom,
  fieldLabel,
  isDirty,
  toInput,
  type CardDraft,
  type DraftProblem,
  type TextField,
} from "@bettertavern/core/scenario/cardEdit";

import { Button, Dots, Field, IconButton, Notice, TextArea } from "../../components/controls.tsx";
import { scenarioPath } from "../../data/scenarioActions.ts";
import { scenariosKey } from "../../data/scenarios.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { BookEditor } from "./BookEditor.tsx";
import styles from "./edit.module.css";

/** 字数到上限的八成时开始显示 */
function lengthHint(text: string, limit: number): string | undefined {
  const n = charCount(text);
  return n >= limit * 0.8 ? `${n} / ${limit}` : undefined;
}

export function EditCardPage() {
  const { id = "" } = useParams();
  const { api } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const queries = useQueryClient();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ScenarioCard | null>(null);
  const [original, setOriginal] = useState<CardDraft | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  // 保存时本地检查没通过之后，每次修改都重新检查，改好的字段马上不再标红
  const [recheck, setRecheck] = useState(false);
  const [saving, setSaving] = useState(false);
  // 保存成功、确认放弃之后要离开：这时不再拦
  const leaving = useRef(false);
  useDocumentTitle(detail ? t("cardEdit.pageTitle", { name: detail.display_name }) : t("scenario.editCard"));

  const apply = useCallback((next: ScenarioCard) => {
    const fresh = draftFrom(next);
    setDetail(next);
    setOriginal(fresh);
    setDraft(fresh);
    setProblems([]);
    setRecheck(false);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      apply(await api.scenarios.card(id));
    } catch (e) {
      setLoadError(e);
    }
  }, [api, id, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = !!original && !!draft && isDirty(original, draft);
  const shown = useMemo(() => (recheck && draft ? checkDraft(draft) : problems), [recheck, draft, problems]);

  // 站内跳转（侧栏、返回、浏览器后退）：先问
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  // blocker 对象跟着路由状态换，弹窗只按 state 弹一次，回答时取最新的那个
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
  });
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void overlay
      .confirm({
        title: t("cardEdit.discardTitle"),
        message: t("cardEdit.discardMessage"),
        confirmLabel: t("cardEdit.discard"),
        cancelLabel: t("cardEdit.keepEditing"),
        tone: "danger",
      })
      .then((ok) => {
        const current = latestBlocker.current;
        if (current.state !== "blocked") return;
        if (!ok) {
          current.reset();
          return;
        }
        leaving.current = true;
        current.proceed();
      });
  }, [blocker.state, overlay]);

  // 刷新、关标签页：浏览器自己的提示
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** 回剧本详情：从详情进来的就后退，直接打开的就换成详情页 */
  const back = (): void => {
    if (location.key !== "default") navigate(-1);
    else navigate(scenarioPath({ id }), { replace: true });
  };

  /** 剧本详情和剧本库里的名字、预览要跟着变 */
  const refreshScenario = (): void => {
    void queries.invalidateQueries({ queryKey: ["scenario", id] });
    void queries.invalidateQueries({ queryKey: scenariosKey });
  };

  if (!draft || !detail) {
    return (
      <div className={styles.page}>
        <header className={styles.bar}>
          <IconButton icon="back" label={t("cardEdit.backToScenario")} onClick={back} />
          <h1 className={styles.title}>{t("scenario.editCard")}</h1>
        </header>
        {loadError ? (
          <Notice
            message={t("cardEdit.loadFailedWith", { error: describeError(loadError) })}
            actionLabel={t("common.reload")}
            onAction={() => void load()}
          />
        ) : (
          <Dots />
        )}
      </div>
    );
  }

  const errorFor = (field: string): string | null => shown.find((p) => p.field === field)?.message ?? null;
  const set = (patch: Partial<CardDraft>): void => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async (): Promise<void> => {
    const local = checkDraft(draft);
    setProblems(local);
    setRecheck(local.length > 0);
    if (local.length > 0) {
      overlay.toast(
        t("cardEdit.needsFixing", { count: local.length, field: describeField(local[0]?.field ?? "") }),
        {
          icon: "alert",
        },
      );
      return;
    }
    setSaving(true);
    let saved: ScenarioCard;
    try {
      saved = await api.scenarios.saveCard(id, toInput(draft, detail.version));
    } catch (e) {
      // 先停下转圈，再弹窗问
      setSaving(false);
      if (e instanceof ApiError && e.code === "CARD_CHANGED") {
        const reload = await overlay.confirm({
          title: t("cardEdit.conflictTitle"),
          message: t("cardEdit.conflictMessage"),
          confirmLabel: t("common.reload"),
        });
        if (reload) await load();
      } else if (e instanceof ApiError && typeof e.field("field") === "string") {
        const field = e.field("field") as string;
        const problem = describeError(e);
        setProblems([{ field, message: problem }]);
        overlay.toast(t("cardEdit.fieldProblem", { field: describeField(field), problem }), {
          icon: "alert",
        });
      } else {
        overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
      }
      return;
    }
    setSaving(false);
    apply(saved);
    refreshScenario();
    overlay.toast(t("cardEdit.saved"));
    leaving.current = true;
    back();
  };

  const reset = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("cardEdit.resetTitle"),
      message: t("cardEdit.resetMessage"),
      confirmLabel: t("cardEdit.resetConfirm"),
      tone: "danger",
      icon: "retry",
    });
    if (!ok) return;
    try {
      apply(await api.scenarios.resetCard(id));
      refreshScenario();
      overlay.toast(t("cardEdit.resetDone"));
    } catch (e) {
      overlay.toast(t("cardEdit.resetFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const textField = (field: TextField, height: number, hint?: string) => (
    <TextArea
      label={fieldLabel(field)}
      optional
      height={height}
      value={draft[field]}
      onChange={(e) => set({ [field]: e.target.value } as Partial<CardDraft>)}
      hint={lengthHint(draft[field], CARD_LIMITS.field) ?? hint}
      error={errorFor(field)}
    />
  );

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <IconButton icon="back" label={t("cardEdit.backToScenario")} onClick={back} />
        <h1 className={styles.title}>{t("scenario.editCard")}</h1>
        <Button
          label={t("common.save")}
          size="sm"
          busy={saving}
          disabled={!dirty}
          onClick={() => void save()}
        />
      </header>
      <Notice tone="info" message={t("cardEdit.notice", { user: "{{user}}", char: "{{char}}" })} />
      {errorFor("card") ? <Notice message={errorFor("card")} /> : null}

      <h2 className={styles.section}>{t("cardEdit.sections.basic")}</h2>
      <Field
        label={fieldLabel("display_name")}
        value={draft.displayName}
        onChange={(e) => set({ displayName: e.target.value })}
        hint={t("cardEdit.hints.displayName")}
        error={errorFor("display_name")}
      />
      <Field
        label={fieldLabel("name")}
        value={draft.name}
        onChange={(e) => set({ name: e.target.value })}
        hint={t("cardEdit.hints.name", { char: "{{char}}" })}
        error={errorFor("name")}
      />
      <Field
        label={fieldLabel("tags")}
        optional
        value={draft.tags}
        onChange={(e) => set({ tags: e.target.value })}
        hint={t("cardEdit.hints.list")}
        error={errorFor("tags")}
      />

      <h2 className={styles.section}>{t("cardEdit.sections.character")}</h2>
      {textField("description", 180, t("cardEdit.hints.description"))}
      {textField("personality", 110)}

      <h2 className={styles.section}>{t("cardEdit.sections.opening")}</h2>
      {textField("scenario", 120, t("cardEdit.hints.scenario"))}
      {textField("first_mes", 150, t("cardEdit.hints.first_mes"))}

      <h2 className={styles.section}>{t("cardEdit.sections.speech")}</h2>
      {textField("mes_example", 150, t("cardEdit.hints.mes_example"))}

      <div className={styles.sectionRow}>
        <h2 className={styles.section}>{t("cardEdit.book")}</h2>
        <span className={styles.sectionMeta}>{t("cardEdit.entries", { count: draft.book.length })}</span>
      </div>
      <p className={styles.note}>{t("cardEdit.bookNote")}</p>
      {errorFor("book") ? <Notice message={errorFor("book")} /> : null}
      <BookEditor book={draft.book} onChange={(book) => set({ book })} errorFor={errorFor} />

      <div className={styles.bottom}>
        <Button
          label={t("cardEdit.saveChanges")}
          size="lg"
          busy={saving}
          disabled={!dirty}
          onClick={() => void save()}
        />
        <Button label={t("cardEdit.reset")} variant="text" onClick={() => void reset()} />
      </div>
    </div>
  );
}
