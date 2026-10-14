/**
 * 服务器地址：登录、注册页底部的一行，点“更改”打开服务器面板。
 * 面板里是最近用过的服务器（单选）加一行“输入新地址”；连接测试页也用这个面板选地址。
 */

import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { normalizeServerUrl } from "../config.ts";
import { displayServer, serverChoices, type RecentServer } from "../features/settings/servers.ts";
import { useApp } from "../state/AppProvider.tsx";
import { usePrefs } from "../state/PrefsProvider.tsx";
import { font, space, usePalette } from "../theme/index.ts";
import { formatRelative } from "../utils/format.ts";
import { Button, Icon, RadioMark, Sheet } from "./ui.tsx";

/** 失败记录多久之内算“刚才” */
const RECENT_FAILURE_MS = 10 * 60_000;

/** 页面底部的服务器行 */
export function ServerRow({ onChange }: { onChange: () => void }) {
  const { serverUrl } = useApp();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`服务器 ${displayServer(serverUrl)}，更改`}
      onPress={onChange}
      style={[styles.row, { borderTopColor: palette.line, paddingBottom: insets.bottom }]}
    >
      <Icon name="server" size={20} color={palette.mut} />
      <Text style={[styles.rowText, { color: palette.mut }]} numberOfLines={1}>
        服务器 <Text style={{ fontFamily: font.mono, color: palette.ink }}>{displayServer(serverUrl)}</Text>
      </Text>
      <View style={styles.change}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: palette.ink }}>更改</Text>
        <Icon name="chevronDown" size={18} color={palette.ink} />
      </View>
    </Pressable>
  );
}

function describe(server: RecentServer, now: Date): { text: string; failed: boolean } | null {
  if (server.failedAt && now.getTime() - new Date(server.failedAt).getTime() < RECENT_FAILURE_MS) {
    return { text: "刚才无法连接", failed: true };
  }
  if (server.lastUsedAt)
    return { text: `上次使用 · ${formatRelative(server.lastUsedAt, now)}`, failed: false };
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
  const palette = usePalette();
  const router = useRouter();
  const current = value ?? serverUrl;
  const choices = serverChoices(servers, current);
  const [selected, setSelected] = useState<string | null>(current);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (visible) {
      setSelected(current);
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
    <Sheet visible={visible} onClose={onClose} title="服务器">
      <View style={styles.body}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="选择服务器"
          style={{ borderTopWidth: 1, borderTopColor: palette.line }}
        >
          {choices.map((server) => {
            const on = selected === server.url;
            const note = describe(server, now);
            return (
              <Pressable
                key={server.url}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setSelected(server.url)}
                style={[styles.option, { borderBottomColor: palette.line }]}
              >
                <RadioMark selected={on} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.url, { color: palette.ink }]} numberOfLines={1}>
                    {displayServer(server.url)}
                  </Text>
                  {note ? (
                    <View style={styles.note}>
                      {note.failed ? <Icon name="cross" size={14} color={palette.err} /> : null}
                      <Text
                        style={{
                          fontSize: 13,
                          lineHeight: 19,
                          color: note.failed ? palette.err : palette.mut,
                        }}
                      >
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
              accessibilityState={{ selected: selected === null }}
              onPress={() => setSelected(null)}
            >
              <RadioMark selected={selected === null} />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onFocus={() => setSelected(null)}
              placeholder="例如 http://192.168.1.10:8000"
              placeholderTextColor={palette.mut}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="新服务器地址"
              style={[
                styles.input,
                { color: palette.ink, borderColor: selected === null ? palette.ink : palette.line2 },
                selected === null ? { borderWidth: 2 } : null,
              ]}
            />
          </View>
        </View>
        <View style={styles.buttons}>
          {showProbe ? (
            <Button
              label="测试连接"
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
            label={onSave ? "使用这个地址" : "保存"}
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
    minHeight: 56,
    paddingLeft: space.page,
    paddingRight: space.s,
    borderTopWidth: 1,
  },
  rowText: { flex: 1, fontSize: 13, lineHeight: 19 },
  change: { flexDirection: "row", alignItems: "center", gap: 2, height: 44, paddingHorizontal: space.m },
  body: { paddingHorizontal: space.page, paddingBottom: space.page, gap: space.l },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 60,
    paddingHorizontal: 2,
    paddingVertical: space.s,
    borderBottomWidth: 1,
  },
  url: { fontFamily: font.mono, fontSize: 14, lineHeight: 20 },
  note: { flexDirection: "row", alignItems: "center", gap: 4 },
  newRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64, paddingHorizontal: 2 },
  input: { flex: 1, height: 44, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.mono, fontSize: 14 },
  buttons: { flexDirection: "row", gap: space.s },
});
