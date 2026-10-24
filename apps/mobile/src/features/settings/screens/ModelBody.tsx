/**
 * 一个模型的详情：服务商、Key、状态、端点；测试这个模型、设为导演；“能记住多少”的格子图和窗口来源说明
 * （拿不到窗口时可以手填）；工作窗口上限和深度思考；底部更换 Key、取消导演、删除。面板见 ModelSheets.tsx。
 * 路由页面是 app/settings/model/[id].tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 * 官方模型的 Key、模型名、端点、窗口不能改，也不用测试：不显示编辑、测试、更换 Key、手填窗口，换成余额和说明。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoute } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";
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

import {
  Button,
  ErrorState,
  Icon,
  IconButton,
  Loading,
  Notice,
  Pill,
  SectionHeader,
  Segmented,
  Status,
  Toggle,
  useColumnStyle,
  useOverlay,
} from "../../../components/ui.tsx";
import { useAsync } from "../../../hooks/useAsync.ts";
import { useApp } from "../../../state/AppProvider.tsx";
import { comicRadius, comicStroke, font, space, useComic } from "../../../theme/index.ts";
import { MemoryBlocks } from "../MemoryBlocks.tsx";
import { EditSheet, ReplaceKeySheet, WindowSheet } from "../ModelSheets.tsx";
import { SettingsBack, useSettingsNav } from "../nav.tsx";
import { ProbeResults } from "../ProbeResults.tsx";

type Message = { tone: "error" | "info"; text: string };

export function ModelBody({ id }: { id: string }) {
  const { api } = useApp();
  const nav = useSettingsNav();
  const column = useColumnStyle();
  const c = useComic();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const { data, error, loading, reload, setData } = useAsync(async () => {
    const [route, providers] = await Promise.all([api.models.get(id), api.models.providers()]);
    // 余额只在官方模型的说明里用，取不到不影响页面
    const credits = route.source === "platform" ? await api.auth.credits().catch(() => null) : null;
    return { route, providers, credits };
  }, [api, id]);

  const [choice, setChoice] = useState<WindowChoice>("default");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [sheet, setSheet] = useState<"edit" | "key" | "window" | null>(null);

  const route = data?.route;
  useEffect(() => {
    if (!route) return;
    setChoice(windowChoice(route.params.working_window));
    setThinking(route.params.thinking === true);
  }, [route]);

  if (loading && !data) return <Loading />;
  if (!data || !route) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
        <SettingsBack />
        <ErrorState
          title={t("models.modelLoadFailed")}
          message={describeError(error)}
          onRetry={() => void reload()}
        />
      </View>
    );
  }
  const { providers, credits } = data;
  const platform = route.source === "platform";
  const provider = providers.find((p) => p.id === route.provider);

  const update = (fresh: ModelRoute): void =>
    setData((current) => (current ? { ...current, route: fresh } : current));

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

  const setWorkbench = (on: boolean): Promise<void> =>
    run(async () => {
      update(await api.models.update(route.id, { workbench: on }));
      overlay.toast(on ? t("models.workbenchOn") : t("models.workbenchOff"));
    });
  const setBackground = (on: boolean): Promise<void> =>
    run(async () => {
      update(await api.models.update(route.id, { background: on }));
      overlay.toast(on ? t("models.backgroundOn") : t("models.backgroundOff"));
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
      overlay.toast(t("common.deleted", { name: modelTitle(route) }));
      nav.back();
    });
  };

  const kind = statusKind(route.status);
  const statusColor = kind === "ok" ? c.forest : kind === "invalid" ? c.err : c.warn;
  const dirty =
    windowChoice(route.params.working_window) !== choice || (route.params.thinking === true) !== thinking;
  const clamped = choiceTokens(choice) > route.window.model_window;
  const note = windowNote(route.window);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.page }}
    >
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={{ flex: 1, gap: space.s }}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: c.ink }, modelTitle(route) === route.model ? styles.mono : null]}
            >
              {modelTitle(route)}
            </Text>
            <View style={styles.statusLine}>
              <Status kind={kind} label={modelStatusLabel(route.status)} />
              {route.is_director ? <Pill tone="acc" label={t("models.directorPill")} /> : null}
              {platform ? <Pill label={t("models.officialPill")} /> : null}
              {route.is_background ? <Pill label={t("models.backgroundPill")} /> : null}
              {route.is_workbench ? <Pill label={t("models.workbenchPill")} /> : null}
            </View>
          </View>
          {platform ? null : (
            <IconButton
              icon="write"
              label={t("models.editLabel")}
              size={20}
              diameter={44}
              onPress={() => setSheet("edit")}
            />
          )}
        </View>
        <View style={styles.grid}>
          {[
            [t("models.provider"), providerName(route.provider, providers), false],
            ["Key", keyText(route), !platform],
            [t("models.modelName"), route.model, true],
            [t("models.endpointShort"), route.base_url ?? t("models.officialShort"), !!route.base_url],
          ].map(([key, value, mono]) => (
            <View key={String(key)} style={[styles.cell, { backgroundColor: c.paper, borderColor: c.ink }]}>
              <Text style={[styles.cellKey, { color: c.mut }]}>{key}</Text>
              <Text
                numberOfLines={1}
                style={[
                  { fontSize: 15, color: c.ink },
                  mono ? { fontFamily: font.mono, fontSize: 14 } : null,
                ]}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>
        {route.status !== "ok" ? (
          <Text style={[styles.hint, { color: statusColor }]}>
            {route.status === "invalid" ? t("models.keyRejected") : t("models.keyUnverified")}
          </Text>
        ) : null}

        {platform ? (
          <Notice
            tone="info"
            message={[t("models.officialFixed"), t("models.creditsNote"), credits ? creditsLine(credits) : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ marginHorizontal: 20, marginTop: space.s }}
          />
        ) : null}
        {platform && route.is_director ? null : (
          <View style={styles.actions}>
            {platform ? null : (
              <Button
                label={t("models.test")}
                variant="secondary"
                onPress={() => void probe()}
                busy={probing}
                style={styles.action}
              >
                <View style={{ alignItems: "center" }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: c.ink }}>{t("models.test")}</Text>
                  <Text style={{ fontFamily: font.mono, fontSize: 10.5, color: c.mut }}>
                    {t("models.testTime")}
                  </Text>
                </View>
              </Button>
            )}
            {route.is_director ? null : (
              <Button
                label={t("models.setDirector")}
                onPress={() => void makeDirector()}
                style={styles.action}
              />
            )}
          </View>
        )}
        {message ? (
          <Notice
            tone={message.tone}
            message={message.text}
            style={{ marginHorizontal: 20, marginTop: space.s }}
          />
        ) : null}
        {route.last_probe ? <ProbeResults report={route.last_probe} /> : null}

        <SectionHeader title={t("models.context")} />
        <MemoryBlocks route={route} choice={choice} />
        {note && !platform ? (
          <Notice
            tone={route.window.source === "learned" ? undefined : "warn"}
            message={note}
            actionLabel={route.window.source === "learned" ? undefined : t("models.fillIn")}
            onAction={route.window.source === "learned" ? undefined : () => setSheet("window")}
            style={{ marginHorizontal: 20, marginTop: space.s }}
          />
        ) : null}

        <SectionHeader title={t("models.workingCap")} />
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <Segmented
            value={choice}
            options={WINDOW_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
            onChange={setChoice}
            mono
            height={52}
          />
          <Text style={{ fontSize: 13, lineHeight: 20, color: c.mut, paddingHorizontal: space.m }}>
            {t("models.workingNote")}
          </Text>
          {clamped ? (
            <Notice
              tone="warn"
              message={t("models.clamped", { window: formatTokens(route.window.model_window) })}
            />
          ) : null}
        </View>

        <SectionHeader title={t("models.style")} />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: thinking }}
          accessibilityLabel={t("models.thinking")}
          onPress={() => setThinking((t) => !t)}
          style={[styles.switchRow, { borderColor: c.ink, backgroundColor: c.paper }]}
        >
          <View style={[styles.switchIcon, { backgroundColor: c.grey, borderColor: c.ink }]}>
            <Icon name="bulb" size={20} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: c.ink }}>{t("models.thinking")}</Text>
            <Text style={{ fontSize: 13, lineHeight: 20, color: c.mut }}>
              {t("models.thinkingNote")}
            </Text>
          </View>
          <Toggle value={thinking} onChange={setThinking} label={t("models.thinking")} />
        </Pressable>
        <View style={{ paddingHorizontal: 20, paddingTop: space.l }}>
          <Button
            label={dirty ? t("common.save") : t("models.saveNoChanges")}
            onPress={() => void saveParams()}
            busy={saving}
            disabled={!dirty}
          />
        </View>

        <BackgroundRow route={route} onChange={(on) => void setBackground(on)} />
        <WorkbenchRow route={route} onChange={(on) => void setWorkbench(on)} />

        <View style={styles.bottom}>
          {platform ? null : (
            <Button
              label={t("models.replaceKey")}
              variant="secondary"
              icon="key"
              onPress={() => setSheet("key")}
            />
          )}
          {route.is_director ? (
            <Button label={t("models.cancelDirector")} variant="text" onPress={() => void cancelDirector()}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: c.err }}>
                {t("models.cancelDirector")}
              </Text>
            </Button>
          ) : null}
          <Button
            label={t("models.deleteModel")}
            variant="danger"
            icon="trash"
            onPress={() => void remove()}
          />
        </View>
      </ScrollView>
      <EditSheet
        visible={sheet === "edit"}
        onClose={() => setSheet(null)}
        route={route}
        provider={provider}
        onSaved={update}
      />
      <ReplaceKeySheet
        visible={sheet === "key"}
        onClose={() => setSheet(null)}
        route={route}
        onSaved={(fresh) => {
          update(fresh);
          setMessage({ tone: "info", text: t("models.keyReplaced", { last4: fresh.key_last4 }) });
        }}
      />
      <WindowSheet
        visible={sheet === "window"}
        onClose={() => setSheet(null)}
        route={route}
        onSaved={update}
      />
    </KeyboardAvoidingView>
  );
}

/** “用于后台整理”开关：点了立刻保存；不能调用工具的模型打不开 */
function BackgroundRow({ route, onChange }: { route: ModelRoute; onChange: (on: boolean) => void }) {
  const c = useComic();
  const { t } = useTranslation();
  const locked = !route.supports_tools && !route.is_background;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: route.is_background, disabled: locked }}
      accessibilityLabel={t("models.background")}
      disabled={locked}
      onPress={() => onChange(!route.is_background)}
      style={[styles.switchRow, { borderColor: c.ink, backgroundColor: c.paper, marginTop: space.l }]}
    >
      <View style={[styles.switchIcon, { backgroundColor: c.grey, borderColor: c.ink }]}>
        <Icon name="world" size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: c.ink }}>{t("models.background")}</Text>
        <Text
          style={{ fontSize: 13, lineHeight: 20, color: route.supports_tools ? c.mut : c.warn }}
        >
          {route.supports_tools ? t("models.backgroundNote") : t("models.backgroundNoTools")}
        </Text>
      </View>
      {locked ? null : (
        <Toggle value={route.is_background} onChange={onChange} label={t("models.background")} />
      )}
    </Pressable>
  );
}

/** “用于工作台”：工作台的 agent 用这个模型（要能调用工具） */
function WorkbenchRow({ route, onChange }: { route: ModelRoute; onChange: (on: boolean) => void }) {
  const c = useComic();
  const { t } = useTranslation();
  const locked = !route.supports_tools && !route.is_workbench;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: route.is_workbench, disabled: locked }}
      accessibilityLabel={t("models.workbench")}
      disabled={locked}
      onPress={() => onChange(!route.is_workbench)}
      style={[styles.switchRow, { borderColor: c.ink, backgroundColor: c.paper, marginTop: space.s }]}
    >
      <View style={[styles.switchIcon, { backgroundColor: c.grey, borderColor: c.ink }]}>
        <Icon name="workbench" size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: c.ink }}>{t("models.workbench")}</Text>
        <Text
          style={{ fontSize: 13, lineHeight: 20, color: route.supports_tools ? c.mut : c.warn }}
        >
          {route.supports_tools ? t("models.workbenchNote") : t("models.workbenchNoTools")}
        </Text>
      </View>
      {locked ? null : (
        <Toggle value={route.is_workbench} onChange={onChange} label={t("models.workbench")} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, minHeight: 60, paddingHorizontal: space.s },
  actions: { flexDirection: "row", gap: space.m, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4 },
  bottom: { paddingHorizontal: 20, paddingTop: space.xl, gap: space.s },
  cell: {
    width: "48%",
    flexGrow: 1,
    paddingVertical: space.m,
    paddingHorizontal: 14,
    gap: 2,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  cellKey: { fontSize: 12.5, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginHorizontal: 20 },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s,
    paddingLeft: 20,
    paddingRight: space.l,
    paddingTop: space.l,
    paddingBottom: space.l,
  },
  hint: { fontSize: 13, lineHeight: 20, paddingHorizontal: 20, paddingTop: space.s },
  mono: { fontFamily: font.monoMedium, fontSize: 24, letterSpacing: -0.4 },
  statusLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 72,
    marginHorizontal: 20,
    paddingVertical: space.m,
    paddingHorizontal: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  switchIcon: {
    width: 40,
    height: 40,
    borderRadius: comicRadius.iconButtonSm,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 28, lineHeight: 36, fontWeight: "900", letterSpacing: -0.56 },
});
