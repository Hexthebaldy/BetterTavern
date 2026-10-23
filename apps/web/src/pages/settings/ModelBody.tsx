/**
 * 一个模型的详情（W14，同 App 的 ModelBody）：名字、状态、导演标记、四格信息；测试这个模型、设为导演、测试结果；
 * “能记住多少”的格子图和窗口来源说明（拿不到窗口时可以手填）；工作窗口上限和深度思考；更换 Key、删除模型、取消导演模型。
 * 右栏够宽（≥ 720）时分两栏：左边是名字到测试结果，右边是上下文到最后。
 * 官方模型的 Key、模型名、端点、窗口不能改，也不用测试：不显示编辑、测试、更换 Key、手填窗口，换成余额和说明。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import {
  creditsLine,
  describeWindow,
  keyText,
  modelStatusLabel,
  modelTitle,
  providerName,
  statusKind,
  windowNote,
} from "@bettertavern/core/settings/labels";
import {
  choiceTokens,
  WINDOW_CHOICES,
  windowChoice,
  type WindowChoice,
} from "@bettertavern/core/settings/window";
import { formatTokens } from "@bettertavern/core/utils/format";

import { Button, cx, Dots, IconButton, Notice, Pill } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useCredits, useModelRoute, useProviders, useRouteUpdater } from "../../data/models.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { MemoryBlocks } from "./MemoryBlocks.tsx";
import { EditDialog, ReplaceKeyDialog, WindowDialog } from "./ModelDialogs.tsx";
import { SectionHeader } from "./parts.tsx";
import { ProbeResults } from "./ProbeResults.tsx";
import { Segmented } from "./Segmented.tsx";
import styles from "./settings.module.css";
import { StatusPill } from "./StatusPill.tsx";

type Message = { tone: "error" | "info"; text: string };

/** /settings/model/:id：换一个模型就换一页（表单里没保存的改动不带过去） */
export function ModelPage() {
  const { id = "" } = useParams();
  return <ModelBody key={id} id={id} />;
}

export function ModelBody({ id, titled = true }: { id: string; titled?: boolean }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const overlay = useOverlay();
  const navigate = useNavigate();
  const query = useModelRoute(id);
  const providers = useProviders();
  const update = useRouteUpdater();
  const credits = useCredits();
  const [choice, setChoice] = useState<WindowChoice>("default");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [dialog, setDialog] = useState<"edit" | "key" | "window" | null>(null);
  const route = query.data;
  useDocumentTitle(titled ? (route ? modelTitle(route) : t("models.title")) : null);

  useEffect(() => {
    if (!route) return;
    setChoice(windowChoice(route.params.working_window));
    setThinking(route.params.thinking === true);
  }, [route]);

  if (!route) {
    return (
      <div className={styles.body}>
        {query.isPending ? (
          <div className={styles.loading}>
            <Dots />
          </div>
        ) : (
          <Notice
            message={t("models.modelLoadFailedWith", { error: describeError(query.error) })}
            actionLabel={t("common.reload")}
            onAction={() => void query.refetch()}
          />
        )}
      </div>
    );
  }
  const provider = providers.data?.find((p) => p.id === route.provider);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage({ tone: "error", text: describeError(e) });
    }
  };
  const probe = (): Promise<void> =>
    run(async () => {
      setProbing(true);
      try {
        await api.models.probe(route.id);
        // 测试结果存在模型上（last_probe），状态也可能变了：重新取一次
        update(await api.models.get(route.id));
      } finally {
        setProbing(false);
      }
    });
  const makeDirector = (): Promise<void> =>
    run(async () => {
      const fresh = await api.models.update(route.id, { director: true });
      update(fresh);
      const [first] = describeWindow(fresh.window);
      setMessage({ tone: "info", text: t("models.madeDirector", { detail: first ?? "" }) });
    });
  const saveParams = (): Promise<void> =>
    run(async () => {
      setSaving(true);
      try {
        const params = { ...route.params, thinking };
        if (choice === "default") delete params.working_window;
        else params.working_window = Number(choice);
        update(await api.models.update(route.id, { params }));
        overlay.toast(t("models.saved"));
      } finally {
        setSaving(false);
      }
    });
  const setBackground = (on: boolean): Promise<void> =>
    run(async () => {
      update(await api.models.update(route.id, { background: on }));
      overlay.toast(on ? t("models.backgroundOn") : t("models.backgroundOff"));
    });
  const setWorkbench = (on: boolean): Promise<void> =>
    run(async () => {
      update(await api.models.update(route.id, { workbench: on }));
      overlay.toast(on ? t("models.workbenchOn") : t("models.workbenchOff"));
    });
  const cancelDirector = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("models.cancelDirectorTitle"),
      message: t("models.cancelDirectorMessage"),
      confirmLabel: t("models.cancelDirector"),
      cancelLabel: t("models.keep"),
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      update(await api.models.update(route.id, { director: false }));
      overlay.toast(t("models.directorCancelled"));
    });
  };
  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("models.deleteTitle"),
      message: route.is_director ? t("models.deleteDirectorMessage") : t("models.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      await api.models.remove(route.id);
      update({ ...route, is_director: false });
      overlay.toast(t("common.deleted", { name: modelTitle(route) }));
      navigate("/settings/models", { replace: true });
    });
  };

  const platform = route.source === "platform";
  const kind = statusKind(route.status);
  const dirty =
    windowChoice(route.params.working_window) !== choice || (route.params.thinking === true) !== thinking;
  const clamped = choiceTokens(choice) > route.window.model_window;
  const note = windowNote(route.window);
  return (
    <div className={cx(styles.body, styles.twoColumns)}>
      <div className={styles.column}>
        <div className={styles.modelHead}>
          <div className={styles.rowText}>
            <h2 className={cx(styles.bodyTitle, modelTitle(route) === route.model && styles.monoTitle)}>{modelTitle(route)}</h2>
            <div className={styles.statusLine}>
              <StatusPill kind={kind} label={modelStatusLabel(route.status)} />
              {route.is_director ? <Pill tone="acc" label={t("models.directorPill")} /> : null}
              {platform ? <Pill label={t("models.officialPill")} /> : null}
              {route.is_background ? <Pill label={t("models.backgroundPill")} /> : null}
              {route.is_workbench ? <Pill label={t("models.workbenchPill")} /> : null}
            </div>
          </div>
          {platform ? null : (
            <IconButton
              icon="write"
              label={t("models.editLabel")}
              diameter={44}
              iconSize={20}
              onClick={() => setDialog("edit")}
            />
          )}
        </div>
        <div className={styles.cells}>
          {(
            [
              [t("models.provider"), providerName(route.provider, providers.data), false],
              ["Key", keyText(route), !platform],
              [t("models.modelName"), route.model, true],
              [t("models.endpointShort"), route.base_url ?? t("models.officialShort"), !!route.base_url],
            ] as const
          ).map(([key, value, mono]) => (
            <div key={key} className={styles.cell}>
              <span className={styles.cellKey}>{key}</span>
              <span className={cx(styles.cellValue, mono && styles.mono)}>{value}</span>
            </div>
          ))}
        </div>
        {route.status !== "ok" ? (
          <p className={cx(styles.hint, route.status === "invalid" ? styles.errText : styles.warnText)}>
            {route.status === "invalid" ? t("models.keyRejected") : t("models.keyUnverified")}
          </p>
        ) : null}
        {platform ? (
          <Notice
            tone="info"
            message={
              <>
                {t("models.officialFixed")} {t("models.creditsNote")}
                {credits.data ? <strong> {creditsLine(credits.data)}</strong> : null}
              </>
            }
          />
        ) : null}
        {platform && route.is_director ? null : (
          <div className={styles.actions}>
            {platform ? null : (
              <button
                type="button"
                className={styles.probeButton}
                disabled={probing}
                onClick={() => void probe()}
              >
                {probing ? (
                  <Dots label={t("models.testing")} />
                ) : (
                  <>
                    <span>{t("models.test")}</span>
                    <span className={styles.probeNote}>{t("models.testTime")}</span>
                  </>
                )}
              </button>
            )}
            {route.is_director ? null : (
              <Button
                label={t("models.setDirector")}
                size="lg"
                className={styles.flex}
                onClick={() => void makeDirector()}
              />
            )}
          </div>
        )}
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        {route.last_probe ? <ProbeResults report={route.last_probe} /> : null}
      </div>

      <div className={styles.column}>
        <SectionHeader title={t("models.context")} />
        <MemoryBlocks route={route} choice={choice} />
        {note && !platform ? (
          <Notice
            tone={route.window.source === "learned" ? "info" : "warn"}
            message={note}
            actionLabel={route.window.source === "learned" ? undefined : t("models.fillIn")}
            onAction={route.window.source === "learned" ? undefined : () => setDialog("window")}
          />
        ) : null}

        <SectionHeader title={t("models.workingCap")} />
        <Segmented
          label={t("models.workingCap")}
          value={choice}
          options={WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
          onChange={setChoice}
          mono
        />
        <p className={styles.note}>{t("models.workingNote")}</p>
        {clamped ? (
          <Notice
            tone="warn"
            message={t("models.clamped", { window: formatTokens(route.window.model_window) })}
          />
        ) : null}

        <SectionHeader title={t("models.style")} />
        <label className={styles.switchRow}>
          <span className={styles.switchIcon}>
            <Icon name="bulb" size={20} />
          </span>
          <span className={styles.rowText}>
            <span>{t("models.thinking")}</span>
            <span className={styles.rowSub}>{t("models.thinkingNote")}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className={styles.toggle}
            checked={thinking}
            onChange={(e) => setThinking(e.target.checked)}
          />
        </label>
        <Button
          label={dirty ? t("common.save") : t("models.saveNoChanges")}
          size="lg"
          busy={saving}
          disabled={!dirty}
          onClick={() => void saveParams()}
        />

        <label className={styles.switchRow}>
          <span className={styles.switchIcon}>
            <Icon name="world" size={20} />
          </span>
          <span className={styles.rowText}>
            <span>{t("models.background")}</span>
            <span className={cx(styles.rowSub, !route.supports_tools && styles.warnText)}>
              {route.supports_tools ? t("models.backgroundNote") : t("models.backgroundNoTools")}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className={styles.toggle}
            checked={route.is_background}
            disabled={!route.supports_tools && !route.is_background}
            onChange={(e) => void setBackground(e.target.checked)}
          />
        </label>

        <label className={styles.switchRow}>
          <span className={styles.switchIcon}>
            <Icon name="workbench" size={20} />
          </span>
          <span className={styles.rowText}>
            <span>{t("models.workbench")}</span>
            <span className={cx(styles.rowSub, !route.supports_tools && styles.warnText)}>
              {route.supports_tools ? t("models.workbenchNote") : t("models.workbenchNoTools")}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className={styles.toggle}
            checked={route.is_workbench}
            disabled={!route.supports_tools && !route.is_workbench}
            onChange={(e) => void setWorkbench(e.target.checked)}
          />
        </label>

        <div className={styles.bottom}>
          {platform ? null : (
            <Button
              label={t("models.replaceKey")}
              variant="secondary"
              icon="key"
              size="lg"
              onClick={() => setDialog("key")}
            />
          )}
          {route.is_director ? (
            <button type="button" className={styles.cancelDirector} onClick={() => void cancelDirector()}>
              {t("models.cancelDirector")}
            </button>
          ) : null}
          <Button
            label={t("models.deleteModel")}
            variant="danger"
            icon="trash"
            size="lg"
            onClick={() => void remove()}
          />
        </div>
      </div>

      {dialog === "edit" ? (
        <EditDialog route={route} provider={provider} onClose={() => setDialog(null)} onSaved={update} />
      ) : null}
      {dialog === "key" ? (
        <ReplaceKeyDialog
          route={route}
          onClose={() => setDialog(null)}
          onSaved={(fresh) => {
            update(fresh);
            setMessage({ tone: "info", text: t("models.keyReplaced", { last4: fresh.key_last4 }) });
          }}
        />
      ) : null}
      {dialog === "window" ? (
        <WindowDialog route={route} onClose={() => setDialog(null)} onSaved={update} />
      ) : null}
    </div>
  );
}
