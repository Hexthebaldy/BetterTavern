/**
 * 设置首页（漫画风，docs/design/comic/mobile/png/29）：最上面是墨底的导演模型格（蓝投影 4；没设置时是引导格），
 * 下面两组：配置（第一行是登录的账户）、其他。“其他”里的“外观”打开主题面板（跟随系统 / 浅色 / 夜间），选了立刻生效；
 * 平板上它是居中对话框。
 *
 * 平板（theme/layout.ts）：中屏单栏，宽 640，居中，逐层进入，和手机一样；
 * 宽屏两栏（tablet/png/14–15）：左栏宽 340，右栏是详情区（features/settings/SettingsPane.tsx），左栏里打开着的那一项
 * 浅蓝底、左边一道蓝线。侧栏里“模型”和“设置”是两块，所以：
 * - 带 section=models：左栏是模型列表（标题“模型”，右边“＋”在右栏打开添加模型），点一行在右栏打开详情，默认导演模型；
 * - 不带：左栏是设置首页，去掉导演模型格和“模型”一行，右栏默认打开账户。
 * 窄屏和中屏忽略 section。
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { ModelRoute } from "@bettertavern/core/api/types";
import { LANGUAGE_NAMES } from "@bettertavern/core/i18n/index";
import { creditsLine, directorLine, modelStatusLabel, windowSourceLabel } from "@bettertavern/core/settings/labels";
import { centerColumn, pane, rail, tabInsets } from "@bettertavern/design/layout";
import { formatTokens } from "@bettertavern/core/utils/format";

import { ProviderMark } from "../../src/components/KeyParts.tsx";
import {
  Button,
  Group,
  GroupLabel,
  Icon,
  LargeHeader,
  ListRow,
  Notice,
  Page,
  Pill,
  press,
  RowIcon,
  useTabBarSpace,
} from "../../src/components/ui.tsx";
import { CLIENT_VERSION } from "../../src/config.ts";
import { AppearanceSheet } from "../../src/features/settings/AppearanceSheet.tsx";
import { LanguageSheet } from "../../src/features/settings/LanguageSheet.tsx";
import { useSettingsNav, type SettingsTarget } from "../../src/features/settings/nav.tsx";
import { ModelRow } from "../../src/features/settings/screens/ModelsBody.tsx";
import { displayServer } from "../../src/features/settings/servers.ts";
import { SettingsPane } from "../../src/features/settings/SettingsPane.tsx";
import { useAsync } from "../../src/hooks/useAsync.ts";
import { useLayout } from "../../src/hooks/useLayout.ts";
import { useApp } from "../../src/state/AppProvider.tsx";
import { usePrefs } from "../../src/state/PrefsProvider.tsx";
import {
  comicDepth,
  comicRadius,
  comicStroke,
  font,
  space,
  useComic,
  useIsDark,
  usePalette,
} from "../../src/theme/index.ts";

/** 导演模型格：墨底、蓝投影 4（夜间墨和纸对调，跟着变成浅色）；手机和中屏有 */
function DirectorCard({ route, onPress }: { route: ModelRoute; onPress: () => void }) {
  const c = useComic();
  const palette = usePalette();
  const dark = useIsDark();
  const { t } = useTranslation();
  const { model_window: total, working_cap: cap, max_tokens: out } = route.window;
  const used = Math.min(cap, total);
  const story = Math.max(0, used - out) / total;
  const output = Math.min(out, used) / total;
  const faint = { color: c.paper, opacity: 0.7 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("settings.directorLabel", { model: route.model })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.ink, borderColor: c.ink },
        press(pressed, comicDepth.raised, c.acc),
      ]}
    >
      <View style={styles.cardTop}>
        <Text style={[{ fontSize: 14 }, faint]}>{t("settings.director")}</Text>
        <Pill
          dot={route.status === "ok"}
          tone={route.status === "ok" ? "accSolid" : route.status === "invalid" ? "err" : "warn"}
          label={modelStatusLabel(route.status)}
          height={24}
        />
      </View>
      <View style={styles.cardMain}>
        <ProviderMark provider={route.provider} size={40} tone="ink" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.model, { color: c.paper }]}>
            {route.model}
          </Text>
          <Text numberOfLines={1} style={[{ fontSize: 13, lineHeight: 19 }, faint]}>
            {directorLine(route)}
          </Text>
        </View>
        <Icon name="chevronRight" size={20} color={c.paper} />
      </View>
      <View style={{ marginTop: space.l, gap: 8 }}>
        {/* 轨道：白天是墨底上一层淡白，夜间（格子变成浅色）是深灰 */}
        <View style={[styles.bar, { backgroundColor: dark ? c.line2 : palette.arrowBg }]} accessibilityElementsHidden>
          <View style={[styles.barPart, { flex: story, backgroundColor: c.paper }]} />
          <View style={[styles.barPart, { flex: output, backgroundColor: c.sky }]} />
          <View style={{ flex: Math.max(0, 1 - story - output) }} />
        </View>
        <View style={styles.cardTop}>
          <Text style={[styles.small, faint]}>{t("settings.workingWindow", { size: formatTokens(used) })}</Text>
          <Text style={[styles.small, faint]}>
            {t("settings.context", { size: formatTokens(total) })}
            {route.window.source === "default" ? ` (${windowSourceLabel("default")})` : ""}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** 还没有导演模型时的引导：白底琥珀框的格子，两步，下面一个主按钮 */
function SetupCard({ hasModels, onPress }: { hasModels: boolean; onPress: () => void }) {
  const c = useComic();
  const { t } = useTranslation();
  const step = (n: number, label: string, current: boolean, done: boolean) => (
    <View style={styles.step}>
      <View
        style={[
          styles.stepKey,
          { borderColor: current ? c.ink : c.line2, backgroundColor: current ? c.ink : c.paper },
        ]}
      >
        {done ? (
          <Icon name="check" size={14} color={c.ink} strokeWidth={2.6} />
        ) : (
          <Text style={{ fontFamily: font.monoMedium, fontSize: 12, color: current ? c.paper : c.mut }}>{n}</Text>
        )}
      </View>
      <Text style={{ fontSize: 15, fontWeight: current ? "700" : "400", color: current ? c.ink : c.mut }}>
        {label}
      </Text>
    </View>
  );
  return (
    <View style={[styles.card, styles.setup, { backgroundColor: c.paper, borderColor: c.warn }]}>
      <Pill tone="warn" icon="alert" label={t("settings.cantStart")} height={24} />
      <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: "900", color: c.ink }}>{t("settings.setupTitle")}</Text>
      <View style={{ gap: 4 }}>
        {step(1, t("settings.setupStep1"), !hasModels, hasModels)}
        {step(2, t("settings.setupStep2"), hasModels, false)}
      </View>
      <Button
        label={hasModels ? t("settings.pickDirector") : t("settings.addModel")}
        trailingIcon="arrowRight"
        between
        onPress={onPress}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { api, user, serverUrl } = useApp();
  const nav = useSettingsNav();
  const router = useRouter();
  const c = useComic();
  const { t } = useTranslation();
  const { theme, language } = usePrefs();
  const { size: layoutSize, width, expanded } = useLayout();
  const params = useLocalSearchParams<{ section?: string }>();
  // 宽屏：侧栏的“模型”一块带 section=models，左栏换成模型列表
  const modelsColumn = expanded && params.section === "models";
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  // 宽屏两栏：右栏打开着哪一项（没点过就用默认的）；侧栏换了一块就重新按默认
  const [picked, setPicked] = useState<SettingsTarget | null>(null);
  useEffect(() => setPicked(null), [modelsColumn]);
  const { data, error, refreshing, refresh, reload } = useAsync(async () => {
    const [routes, credits] = await Promise.all([
      api.models.list(),
      // 余额取不到不影响别的
      api.auth.credits().catch(() => null),
    ]);
    return { director: routes.find((r) => r.is_director) ?? null, routes, credits };
  }, [api]);
  const reloadQuietly = useCallback(() => void refresh(), [refresh]);

  const { bottom: bottomSpace } = useTabBarSpace();
  const director = data?.director ?? null;
  const routes = data?.routes ?? [];
  const name = user?.display_name || user?.email || t("settings.account");
  const defaultRoot = (): SettingsTarget | null => {
    if (!modelsColumn) return { screen: "account" };
    if (!data) return null;
    const first = director ?? routes[0];
    return first ? { screen: "model", id: first.id } : { screen: "addModel" };
  };
  const paneRoot: SettingsTarget | null = picked ?? defaultRoot();
  const open = (target: SettingsTarget): void => {
    if (!expanded) {
      nav.open(target);
      return;
    }
    setPicked(target);
    // 手机上回到设置首页时会重新取数据；两栏时左栏一直在，换一项时取一次（右栏里可能刚换了导演）
    void refresh();
  };
  const isOpen = (screen: SettingsTarget["screen"]): boolean => expanded && paneRoot?.screen === screen;
  const openModels = (): void => (expanded ? router.setParams({ section: "models" }) : open({ screen: "models" }));

  // 中屏：标题和居中的那一栏对齐；宽屏：左栏从导航栏右边开始，宽 340
  const sides = tabInsets(layoutSize);
  const column = sides ? centerColumn(width, sides) : null;
  const headerInsets = expanded
    ? { left: rail.contentLeft + space.m, right: width - rail.contentLeft - pane.list }
    : column
      ? { left: column.left + space.m, right: column.right + space.m }
      : undefined;
  return (
    <Page
      header={
        <LargeHeader title={modelsColumn ? t("nav.models") : t("nav.settings")} insets={headerInsets}>
          {modelsColumn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("models.add")}
              onPress={() => open({ screen: "addModel" })}
              style={({ pressed }) => [
                styles.add,
                { backgroundColor: c.ink, borderColor: c.ink },
                press(pressed, comicDepth.iconButton, c.acc),
              ]}
            >
              <Icon name="plus" size={22} color={c.paper} />
            </Pressable>
          ) : null}
        </LargeHeader>
      }
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      bottomSpace={bottomSpace}
      maxWidth={expanded ? null : undefined}
      contentStyle={[
        { paddingHorizontal: 20, gap: 0 },
        expanded ? { marginLeft: rail.contentLeft - 20, width: pane.list + 40 } : null,
      ]}
      overlay={expanded && paneRoot ? <SettingsPane root={paneRoot} onNavigate={reloadQuietly} /> : null}
    >
      {error ? (
        <Notice
          icon="offline"
          message={describeError(error)}
          actionLabel={t("common.retry")}
          onAction={() => void reload()}
          style={{ marginTop: space.s }}
        />
      ) : null}
      {modelsColumn ? (
        <ModelsColumn
          routes={routes}
          credits={data?.credits ?? null}
          openId={paneRoot?.screen === "model" ? paneRoot.id : null}
          onOpen={(id) => open({ screen: "model", id })}
        />
      ) : null}
      {modelsColumn ? null : director ? (
        expanded ? null : <DirectorCard route={director} onPress={() => open({ screen: "model", id: director.id })} />
      ) : data ? (
        <SetupCard hasModels={routes.length > 0} onPress={openModels} />
      ) : null}

      {modelsColumn ? null : (
        <>
          <GroupLabel style={styles.label}>{t("settings.groupConfig")}</GroupLabel>
          <Group>
            <ListRow
              key="account"
              title={name}
              subtitle={user?.display_name ? user.email : undefined}
              leading={
                <View style={[styles.avatar, { backgroundColor: c.acc, borderColor: c.ink }]}>
                  <Text style={{ fontSize: 16, fontWeight: "900", color: c.onAcc }}>{[...name][0] ?? "?"}</Text>
                </View>
              }
              onPress={() => open({ screen: "account" })}
              selected={isOpen("account")}
            />
            {data && !director && !expanded ? (
              <ListRow
                key="director"
                title={t("settings.director")}
                subtitle={t("settings.notSet")}
                subtitleColor={c.warn}
                leading={<RowIcon name="director" />}
                onPress={() => open({ screen: "models" })}
              />
            ) : null}
            {expanded ? null : (
              <ListRow
                key="models"
                title={t("settings.models")}
                subtitle={t("settings.modelsSub")}
                leading={<RowIcon name="key" />}
                trailing={
                  data ? (
                    routes.length > 0 ? (
                      <Text style={{ fontFamily: font.monoMedium, fontSize: 13.5, color: c.mut }}>{routes.length}</Text>
                    ) : (
                      <Text style={{ fontSize: 12.5, color: c.mut }}>{t("settings.noneAdded")}</Text>
                    )
                  ) : null
                }
                onPress={() => open({ screen: "models" })}
              />
            )}
            <ListRow
              key="tools"
              title={t("settings.tools")}
              subtitle={t("settings.toolsSub")}
              leading={<RowIcon name="search" />}
              onPress={() => open({ screen: "tools" })}
              selected={isOpen("tools")}
            />
          </Group>
          <GroupLabel style={styles.label}>{t("settings.groupOther")}</GroupLabel>
          <Group>
            <ListRow
              title={t("appearance.title")}
              leading={<RowIcon name="moon" />}
              trailing={<Text style={{ fontSize: 13.5, color: c.mut }}>{t(`appearance.${theme}`)}</Text>}
              onPress={() => setAppearanceOpen(true)}
            />
            <ListRow
              title={t("language.title")}
              leading={<RowIcon name="language" />}
              trailing={
                <Text style={{ fontSize: 13.5, color: c.mut }}>
                  {language === "system" ? t("language.system") : LANGUAGE_NAMES[language]}
                </Text>
              }
              onPress={() => setLanguageOpen(true)}
            />
            <ListRow
              title={t("settings.probe")}
              subtitle={t("settings.probeSub")}
              leading={<RowIcon name="probe" />}
              onPress={() => open({ screen: "probe" })}
              selected={isOpen("probe")}
            />
          </Group>
          <Text style={[styles.footer, { color: c.mut }]}>
            v{CLIENT_VERSION} · {displayServer(serverUrl)}
          </Text>
        </>
      )}
      <AppearanceSheet visible={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      <LanguageSheet visible={languageOpen} onClose={() => setLanguageOpen(false)} />
    </Page>
  );
}

/** 宽屏左栏的模型列表（带 section=models 时）：官方点数，下面“我的模型”，点一行在右栏打开 */
function ModelsColumn({
  routes,
  credits,
  openId,
  onOpen,
}: {
  routes: ModelRoute[];
  credits: { platform: boolean; balance: number; turns_left: number } | null;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {credits?.platform ? (
        <Notice tone={credits.balance > 0 ? "info" : "warn"} message={creditsLine(credits)} style={styles.notice} />
      ) : null}
      {routes.length > 0 ? (
        <>
          <GroupLabel style={styles.label}>{t("models.mine")}</GroupLabel>
          <Group>
            {routes.map((r) => (
              <ModelRow key={r.id} route={r} selected={r.id === openId} onPress={() => onOpen(r.id)} />
            ))}
          </Group>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.s,
    padding: 18,
    borderRadius: comicRadius.frame,
    borderWidth: comicStroke.frame,
  },
  setup: { gap: 14 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardMain: { flexDirection: "row", alignItems: "center", gap: space.m, marginTop: space.m },
  model: { fontFamily: font.monoMedium, fontSize: 20, lineHeight: 26 },
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden" },
  barPart: { height: 8 },
  small: { fontFamily: font.monoMedium, fontSize: 12 },
  step: { flexDirection: "row", alignItems: "center", gap: space.m, height: 40 },
  stepKey: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { paddingHorizontal: 4, paddingTop: 22 },
  notice: { marginTop: space.s },
  add: {
    width: 44,
    height: 44,
    borderRadius: comicRadius.iconButton,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingVertical: space.l,
    paddingHorizontal: 4,
    fontFamily: font.monoMedium,
    fontSize: 11.5,
    lineHeight: 17,
  },
});
