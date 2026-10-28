/**
 * 人设（同网页端 pages/settings/PersonasPage.tsx，docs/personas.md）：人设库里的人设一行一个（头像、名字、默认、描述的开头），
 * 点一行进编辑页（PersonaBody.tsx）；顶上是新建人设、导入 SillyTavern 的人设备份（只有名字和描述）。
 * 路由页面是 app/settings/personas.tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { Persona } from "@bettertavern/core/api/types";

import { Portrait } from "../../../components/Portrait.tsx";
import { Button, ErrorState, Loading, Pill, useColumnStyle, useOverlay } from "../../../components/ui.tsx";
import { useApp } from "../../../state/AppProvider.tsx";
import { comicRadius, comicStroke, space, useComic } from "../../../theme/index.ts";
import { usePersonas } from "../../personas/usePersonas.ts";
import { SettingsBack, useSettingsNav } from "../nav.tsx";

function PersonaRow({ persona, onPress }: { persona: Persona; onPress: () => void }) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={persona.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: c.ink, backgroundColor: pressed ? c.grey : c.paper },
      ]}
    >
      <Portrait name={persona.name} seed={persona.id} blobId={persona.avatar_blob_id} size={48} rounded={24} />
      <View style={styles.rowText}>
        <View style={styles.rowName}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "700", color: c.ink, flexShrink: 1 }}>
            {persona.name}
          </Text>
          {persona.is_default ? <Pill tone="acc" label={t("personas.defaultBadge")} height={22} /> : null}
        </View>
        <Text numberOfLines={2} style={{ fontSize: 13.5, lineHeight: 20, color: persona.description ? c.ink2 : c.mut }}>
          {persona.description || t("personas.noDescription")}
        </Text>
        {persona.scenario_count > 0 ? (
          <Text style={{ fontSize: 12.5, color: c.mut }}>
            {t("personas.usedBy", { count: persona.scenario_count })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function PersonasBody() {
  const { api } = useApp();
  const c = useComic();
  const nav = useSettingsNav();
  const overlay = useOverlay();
  const column = useColumnStyle();
  const { t } = useTranslation();
  const { data, error, loading, reload, setData } = usePersonas();
  const [importing, setImporting] = useState(false);

  const importBackup = async (): Promise<void> => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    const file = picked.canceled ? undefined : picked.assets[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.personas.importBackup(new File(file.uri));
      setData(() => result.personas);
      overlay.toast(t("personas.imported", { created: result.created, skipped: result.skipped }), { icon: "check" });
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    } finally {
      setImporting(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
        <SettingsBack />
        <ErrorState title={t("personas.title")} message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.big, { color: c.ink }]}>
            {t("personas.title")}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, color: c.mut }}>{t("personas.sub")}</Text>
        </View>
        <View style={styles.actions}>
          <Button label={t("personas.add")} icon="plus" small onPress={() => nav.open({ screen: "persona", id: "new" })} />
          <Button
            label={t("personas.importBackup")}
            icon="import"
            small
            variant="secondary"
            busy={importing}
            onPress={() => void importBackup()}
          />
          <Text style={[styles.note, { color: c.mut }]}>{t("personas.importHint")}</Text>
        </View>
        <View style={styles.list}>
          {data.length === 0 ? (
            <View style={[styles.none, { borderColor: c.grey2 }]}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: c.ink }}>{t("personas.none")}</Text>
              <Text style={{ fontSize: 13.5, lineHeight: 20, color: c.mut }}>{t("personas.noneHint")}</Text>
            </View>
          ) : null}
          {data.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              onPress={() => nav.open({ screen: "persona", id: persona.id })}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.page, paddingTop: space.s, paddingBottom: space.s, gap: space.s },
  big: { fontSize: 28, lineHeight: 34, fontWeight: "900" },
  actions: { paddingHorizontal: space.page, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s },
  note: { width: "100%", fontSize: 12.5, lineHeight: 18 },
  list: { paddingHorizontal: space.page, paddingTop: space.m, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  rowText: { flex: 1, gap: 3 },
  rowName: { flexDirection: "row", alignItems: "center", gap: 8 },
  none: { padding: 16, gap: 4, borderWidth: comicStroke.control, borderStyle: "dashed", borderRadius: comicRadius.frame },
});
