/**
 * 一个模型的详情（W14，同 App 的 ModelBody）：名字、状态、导演标记、四格信息；测试这个模型、设为导演、测试结果；
 * “能记住多少”的格子图和窗口来源说明（拿不到窗口时可以手填）；工作窗口上限和深度思考；更换 Key、删除模型、取消导演模型。
 * 右栏够宽（≥ 720）时分两栏：左边是名字到测试结果，右边是上下文到最后。
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import {
  describeWindow,
  MODEL_STATUS,
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
import { useModelRoute, useProviders, useRouteUpdater } from "../../data/models.ts";
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
  const { api } = useApp();
  const overlay = useOverlay();
  const navigate = useNavigate();
  const query = useModelRoute(id);
  const providers = useProviders();
  const update = useRouteUpdater();
  const [choice, setChoice] = useState<WindowChoice>("default");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [dialog, setDialog] = useState<"edit" | "key" | "window" | null>(null);
  const route = query.data;
  useDocumentTitle(titled ? (route ? modelTitle(route) : "模型") : null);

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
            message={`模型没加载出来：${describeError(query.error)}`}
            actionLabel="重新加载"
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
      setMessage({ tone: "info", text: `已设为导演模型。${first ?? ""}` });
    });
  const saveParams = (): Promise<void> =>
    run(async () => {
      setSaving(true);
      try {
        const params = { ...route.params, thinking };
        if (choice === "default") delete params.working_window;
        else params.working_window = Number(choice);
        update(await api.models.update(route.id, { params }));
        overlay.toast("已保存");
      } finally {
        setSaving(false);
      }
    });
  const cancelDirector = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "取消导演模型？",
      message: "取消后，新的回合会因为没有模型而无法生成，直到再选一个。",
      confirmLabel: "取消导演模型",
      cancelLabel: "保留",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      update(await api.models.update(route.id, { director: false }));
      overlay.toast("已取消导演模型");
    });
  };
  const remove = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "删除这个模型？",
      message: route.is_director
        ? "它是现在的导演。删除后新的回合没法生成，直到再选一个导演。"
        : "删除后要用它得重新添加。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      await api.models.remove(route.id);
      update({ ...route, is_director: false });
      overlay.toast(`已删除“${modelTitle(route)}”`);
      navigate("/settings/models", { replace: true });
    });
  };

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
            <h2 className={cx(styles.bodyTitle, !route.label && styles.monoTitle)}>{modelTitle(route)}</h2>
            <div className={styles.statusLine}>
              <StatusPill kind={kind} label={MODEL_STATUS[route.status]} />
              {route.is_director ? <Pill tone="acc" label="导演" /> : null}
            </div>
          </div>
          <IconButton
            icon="write"
            label="编辑备注名、模型名和端点"
            diameter={44}
            iconSize={20}
            onClick={() => setDialog("edit")}
          />
        </div>
        <div className={styles.cells}>
          {(
            [
              ["服务商", providerName(route.provider, providers.data), false],
              ["Key", `•••• ${route.key_last4}`, true],
              ["模型", route.model, true],
              ["端点", route.base_url ?? "官方地址", !!route.base_url],
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
            {route.status === "invalid"
              ? "服务商拒绝了这个 Key，请更换 Key。"
              : "还没确认这个 Key 能用：测试一下这个模型就知道了。"}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.probeButton}
            disabled={probing}
            onClick={() => void probe()}
          >
            {probing ? (
              <Dots label="测试中" />
            ) : (
              <>
                <span>测试这个模型</span>
                <span className={styles.probeNote}>约 30 秒</span>
              </>
            )}
          </button>
          {route.is_director ? null : (
            <Button
              label="设为导演模型"
              size="lg"
              className={styles.flex}
              onClick={() => void makeDirector()}
            />
          )}
        </div>
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        {route.last_probe ? <ProbeResults report={route.last_probe} /> : null}
      </div>

      <div className={styles.column}>
        <SectionHeader title="上下文" />
        <MemoryBlocks route={route} choice={choice} />
        {note ? (
          <Notice
            tone={route.window.source === "learned" ? "info" : "warn"}
            message={note}
            actionLabel={route.window.source === "learned" ? undefined : "填写"}
            onAction={route.window.source === "learned" ? undefined : () => setDialog("window")}
          />
        ) : null}

        <SectionHeader title="工作窗口上限" />
        <Segmented
          label="工作窗口上限"
          value={choice}
          options={WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
          onChange={setChoice}
          mono
        />
        <p className={styles.note}>
          窗口越大，导演记得越多，但每轮更慢、更贵。用到 80% 时，早期剧情会被压缩成摘要。
        </p>
        {clamped ? (
          <Notice
            tone="warn"
            message={`这个模型只有 ${formatTokens(route.window.model_window)} 上下文，工作窗口会按 ${formatTokens(route.window.model_window)} 算。`}
          />
        ) : null}

        <SectionHeader title="写法" />
        <label className={styles.switchRow}>
          <span className={styles.switchIcon}>
            <Icon name="bulb" size={20} />
          </span>
          <span className={styles.rowText}>
            <span>深度思考</span>
            <span className={styles.rowSub}>模型支持时先思考再写，更慢</span>
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
          label={dirty ? "保存" : "保存 · 没有改动"}
          size="lg"
          busy={saving}
          disabled={!dirty}
          onClick={() => void saveParams()}
        />

        <div className={styles.bottom}>
          <Button
            label="更换 Key"
            variant="secondary"
            icon="key"
            size="lg"
            onClick={() => setDialog("key")}
          />
          {route.is_director ? (
            <button type="button" className={styles.cancelDirector} onClick={() => void cancelDirector()}>
              取消导演模型
            </button>
          ) : null}
          <Button label="删除模型" variant="danger" icon="trash" size="lg" onClick={() => void remove()} />
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
            setMessage({ tone: "info", text: `Key 已更换，尾号 ${fresh.key_last4}` });
          }}
        />
      ) : null}
      {dialog === "window" ? (
        <WindowDialog route={route} onClose={() => setDialog(null)} onSaved={update} />
      ) : null}
    </div>
  );
}
