/**
 * 服务器地址：登录、注册页底部的一条墨色虚线胶囊，点“更改”打开服务器面板。
 * 面板里是一个墨线格子：最近用过的服务器（单选行）加一行“输入新地址”；连接测试页也用这个面板选地址。
 * 没有默认地址时（自己构建、没写 EXPO_PUBLIC_API_URL）胶囊上写“未设置”，登录、注册时先打开面板。
 */

import { useRouter } from "expo-router";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { formatRelative } from "@bettertavern/core/utils/format";

import { normalizeServerUrl } from "../config.ts";
import { displayServer, serverChoices, type RecentServer } from "../features/settings/servers.ts";
import { useApp } from "../state/AppProvider.tsx";
import { usePrefs } from "../state/PrefsProvider.tsx";
import { comicDepth, comicStroke, font, space, useComic } from "../theme/index.ts";
import { press } from "./press.ts";
import { Button, Group, Icon, RadioMark, Sheet } from "./ui.tsx";

/** 失败记录多久之内算“刚才” */
const RECENT_FAILURE_MS = 10 * 60_000;

/** 页面底部的服务器行 */
export function ServerRow({ onChange, width }: { onChange: () => void; width?: number | null }) {
  const { serverUrl } = useApp();
  const c = useComic();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("server.rowLabel", {
        server: serverUrl ? displayServer(serverUrl) : t("server.notSet"),
      })}
      onPress={onChange}
      style={[
        styles.row,
        { marginBottom: Math.max(insets.bottom, space.l), borderColor: c.ink },
        // 平板：和表单一样宽、居中（登录页的 AuthLayout）
        width ? { width, alignSelf: "center", marginHorizontal: 0 } : null,
      ]}
    >
      {({ pressed }) => (
        <>
          <Icon name="server" size={20} color={c.ink} />
          <Text style={[styles.rowText, { color: c.ink2 }]} numberOfLines={1}>
            {t("server.label")}{" "}
            {serverUrl ? (
              <Text style={{ fontFamily: font.monoMedium, fontWeight: "700", color: c.ink }}>
                {displayServer(serverUrl)}
              </Text>
            ) : (
              <Text style={{ fontWeight: "700", color: c.ink }}>{t("server.notSet")}</Text>
            )}
          </Text>
          <View
            style={[
              styles.change,
              { borderColor: c.ink, backgroundColor: c.paper },
              press(pressed, comicDepth.focus, c.ink),
            ]}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: c.ink }}>{t("server.change")}</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

function describe(server: RecentServer, now: Date, t: TFunction): { text: string; failed: boolean } | null {
  if (server.failedAt && now.getTime() - new Date(server.failedAt).getTime() < RECENT_FAILURE_MS) {
    return { text: t("server.failedRecently"), failed: true };
  }
  if (server.lastUsedAt)
    return { text: t("server.lastUsed", { time: formatRelative(server.lastUsedAt, now) }), failed: false };
  return null;
}

/**
 * 选服务器的面板。onSave 不传时保存为 App 的服务器地址；
 * 连接测试页传自己的 onSave，只用来选一个地址去测，不改 App 的设置。
 */
export function ServerSheet({
  visible,
  onClose,
  value,
  onSave,
  showProbe = true,
}: {
  visible: boolean;
  onClose: () => void;
  /** 当前选中的地址，默认是 App 正在用的 */
  value?: string;
  onSave?: (url: string) => void;
  showProbe?: boolean;
}) {
  const { serverUrl, setServerUrl } = useApp();
  const { servers, serverUsed } = usePrefs();
  const c = useComic();
  const router = useRouter();
  const { t } = useTranslation();
  const current = value ?? serverUrl;
  const choices = serverChoices(servers, current);
  // 还没设置服务器时一个都不选，等用户输入新地址
  const [selected, setSelected] = useState<string | null>(current || null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (visible) {
      setSelected(current || null);
      setDraft("");
    }
  }, [visible, current]);

  const typed = normalizeServerUrl(draft);
  const chosen = selected ?? typed;
  const now = new Date();

  const save = (): void => {
    if (!chosen) return;
    if (onSave) onSave(chosen);
    else {
      void setServerUrl(chosen);
      serverUsed(chosen);
    }
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("server.title")}>
      <View style={styles.body}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("server.choose")}>
          <Group>
            {choices.map((server) => {
              const on = selected === server.url;
              const note = describe(server, now, t);
              return (
                <Pressable
                  key={server.url}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSelected(server.url)}
                  style={({ pressed }) => [styles.option, { backgroundColor: pressed ? c.grey : "transparent" }]}
                >
                  <RadioMark selected={on} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.url, { color: c.ink }]} numberOfLines={1}>
                      {displayServer(server.url)}
                    </Text>
                    {note ? (
                      <View style={styles.note}>
                        {note.failed ? <Icon name="cross" size={14} color={c.err} /> : null}
                        <Text style={{ fontSize: 12.5, lineHeight: 18, color: note.failed ? c.err : c.mut }}>
                          {note.text}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
            <View style={styles.newRow}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={t("server.newAddress")}
                accessibilityState={{ selected: selected === null }}
                onPress={() => setSelected(null)}
                hitSlop={10}
              >
                {selected === null ? <RadioMark selected /> : <Icon name="plus" size={22} color={c.ink} />}
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onFocus={() => setSelected(null)}
                placeholder={t("server.newPlaceholder")}
                placeholderTextColor={c.mut}
                selectionColor={c.acc}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel={t("server.newLabel")}
                style={[styles.input, { color: c.ink }]}
              />
            </View>
          </Group>
        </View>
        <View style={styles.buttons}>
          {showProbe ? (
            <Button
              label={t("server.test")}
              variant="secondary"
              icon="probe"
              disabled={!chosen}
              onPress={() => {
                onClose();
                router.push({ pathname: "/dev/probe", params: { url: chosen } });
              }}
              style={{ flex: 1 }}
            />
          ) : null}
          <Button
            label={onSave ? t("server.useThis") : t("common.save")}
            onPress={save}
            disabled={!chosen}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 56,
    marginHorizontal: 20,
    paddingLeft: space.l,
    paddingRight: 7,
    borderRadius: 28,
    borderWidth: comicStroke.control,
    borderStyle: "dashed",
  },
  rowText: { flex: 1, fontSize: 14, lineHeight: 20 },
  change: {
    height: 40,
    paddingHorizontal: space.l,
    borderRadius: 20,
    borderWidth: comicStroke.control,
    justifyContent: "center",
  },
  body: { paddingHorizontal: 18, paddingBottom: space.s, gap: space.l },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  url: { fontFamily: font.monoMedium, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  note: { flexDirection: "row", alignItems: "center", gap: 4 },
  newRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingLeft: 14,
    paddingRight: space.s,
  },
  input: { flex: 1, height: 44, fontFamily: font.mono, fontSize: 15 },
  buttons: { flexDirection: "row", gap: space.m, paddingBottom: comicDepth.raised },
});
