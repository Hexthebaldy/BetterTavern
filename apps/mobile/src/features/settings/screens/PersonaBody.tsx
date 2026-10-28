/**
 * 编辑一个人设（同网页端 PersonasPage.tsx 右边的编辑格，docs/personas.md）：头像（服务端裁成正方形）、名字、描述（导演每回合都看）、
 * 设为默认；保存、删除。id 为 new 是新建：先选好的头像在保存以后再传。
 * 路由页面是 app/settings/persona/[id].tsx；宽屏设置两栏时嵌在右栏里（见 ../nav.tsx）。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Persona } from "@bettertavern/core/api/types";
import { PERSONA_DESCRIPTION_MAX, PERSONA_NAME_MAX } from "@bettertavern/core/scenario/persona";

import { Portrait } from "../../../components/Portrait.tsx";
import {
  Button,
  ErrorState,
  Field,
  Loading,
  Notice,
  Toggle,
  useColumnStyle,
  useOverlay,
} from "../../../components/ui.tsx";
import { useApp } from "../../../state/AppProvider.tsx";
import { comicStroke, space, useComic } from "../../../theme/index.ts";
import { usePersonas } from "../../personas/usePersonas.ts";
import { SettingsBack, useSettingsNav } from "../nav.tsx";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function Editor({ persona, onSaved }: { persona: Persona | null; onSaved: (persona: Persona) => void }) {
  const { api } = useApp();
  const c = useComic();
  const nav = useSettingsNav();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const [current, setCurrent] = useState<Persona | null>(persona);
  const [name, setName] = useState(persona?.name ?? "");
  const [description, setDescription] = useState(persona?.description ?? "");
  const [isDefault, setIsDefault] = useState(persona?.is_default ?? false);
  // 新建时先选好的头像（本地文件），保存以后再传
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fieldError = (field: string): string | undefined =>
    error instanceof ApiError && error.field("field") === field ? describeError(error) : undefined;
  const changed =
    current === null ||
    name.trim() !== current.name ||
    description.trim() !== current.description ||
    isDefault !== current.is_default;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      let saved: Persona;
      if (current === null) {
        saved = await api.personas.create({ name, description, is_default: isDefault });
        if (pending) saved = await api.personas.setAvatar(saved.id, new File(pending));
      } else {
        saved = await api.personas.update(current.id, { name, description, is_default: isDefault });
      }
      setCurrent(saved);
      setPending(null);
      overlay.toast(t("personas.saved"), { icon: "check" });
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (): Promise<void> => {
    const picked = await DocumentPicker.getDocumentAsync({ type: IMAGE_TYPES, copyToCacheDirectory: true, multiple: false });
    const file = picked.canceled ? undefined : picked.assets[0];
    if (!file) return;
    if (current === null) {
      setPending(file.uri);
      return;
    }
    setBusy(true);
    try {
      setCurrent(await api.personas.setAvatar(current.id, new File(file.uri)));
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    } finally {
      setBusy(false);
    }
  };

  const removeAvatar = async (): Promise<void> => {
    if (current === null) {
      setPending(null);
      return;
    }
    setBusy(true);
    try {
      setCurrent(await api.personas.removeAvatar(current.id));
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (current === null) return;
    const ok = await overlay.confirm({
      title: t("personas.deleteTitle", { name: current.name }),
      message:
        current.scenario_count > 0
          ? t("personas.deleteBodyUsed", { count: current.scenario_count })
          : t("personas.deleteBody"),
      confirmLabel: t("personas.delete"),
      tone: "danger",
      icon: "trash",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.personas.remove(current.id);
      nav.back();
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
      setBusy(false);
    }
  };

  const hasAvatar = current ? current.avatar_blob_id !== null : pending !== null;
  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.big, { color: c.ink }]}>
          {current ? t("personas.editTitle") : t("personas.newTitle")}
        </Text>
      </View>
      <View style={styles.avatarRow}>
        {pending ? (
          <Image source={{ uri: pending }} style={[styles.preview, { borderColor: c.ink }]} />
        ) : (
          <Portrait name={name || "?"} seed={current?.id ?? "new"} blobId={current?.avatar_blob_id} size={88} rounded={44} />
        )}
        <View style={{ gap: 6, flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: c.ink }}>{t("personas.avatar")}</Text>
          <View style={styles.avatarButtons}>
            <Button label={t("personas.changeAvatar")} icon="image" small variant="secondary" disabled={busy} onPress={() => void pickAvatar()} />
            {hasAvatar ? (
              <Button label={t("personas.removeAvatar")} small variant="text" disabled={busy} onPress={() => void removeAvatar()} />
            ) : null}
          </View>
          <Text style={{ fontSize: 12.5, color: c.mut }}>{t("personas.avatarHint")}</Text>
        </View>
      </View>
      <View style={styles.form}>
        <Field
          label={t("personas.name")}
          value={name}
          onChangeText={setName}
          maxLength={PERSONA_NAME_MAX}
          placeholder={t("personas.namePlaceholder")}
          error={fieldError("name")}
        />
        <Field
          label={t("personas.description")}
          optional
          multiline
          counter
          boxHeight={180}
          value={description}
          onChangeText={setDescription}
          maxLength={PERSONA_DESCRIPTION_MAX}
          placeholder={t("personas.descriptionPlaceholder")}
          hint={t("personas.descriptionHint")}
          error={fieldError("description")}
        />
        <View style={styles.defaultRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: c.ink }}>{t("personas.setDefault")}</Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: c.mut }}>{t("personas.defaultNote")}</Text>
          </View>
          <Toggle value={isDefault} onChange={setIsDefault} label={t("personas.setDefault")} />
        </View>
        {error && !fieldError("name") && !fieldError("description") ? <Notice message={describeError(error)} /> : null}
        <Button label={t("personas.save")} busy={busy} disabled={!name.trim() || !changed} onPress={() => void save()} />
        {current ? (
          <Button label={t("personas.delete")} icon="trash" variant="danger" disabled={busy} onPress={() => void remove()} />
        ) : null}
      </View>
    </>
  );
}

export function PersonaBody({ id }: { id: string }) {
  const c = useComic();
  const column = useColumnStyle();
  const { t } = useTranslation();
  const { data, error, loading, reload } = usePersonas();
  if (id !== "new" && loading && !data) return <Loading />;
  const persona = id === "new" ? null : (data?.find((p) => p.id === id) ?? null);
  if (id !== "new" && !persona) {
    return (
      <View style={{ flex: 1, backgroundColor: c.page }}>
        <SettingsBack />
        <ErrorState title={t("personas.title")} message={describeError(error)} onRetry={() => void reload()} />
      </View>
    );
  }
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: c.page }}>
      <SettingsBack />
      <ScrollView contentContainerStyle={[{ paddingBottom: 56 }, column]} keyboardShouldPersistTaps="handled">
        {/* 新建以后留在这一页接着编辑（换头像之类）：编辑格自己记着存好的人设 */}
        <Editor key={persona?.id ?? "new"} persona={persona} onSaved={() => void reload()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.page, paddingTop: space.s, paddingBottom: space.s },
  big: { fontSize: 28, lineHeight: 34, fontWeight: "900" },
  avatarRow: { paddingHorizontal: space.page, flexDirection: "row", alignItems: "center", gap: 16 },
  preview: { width: 88, height: 88, borderRadius: 44, borderWidth: comicStroke.frame },
  avatarButtons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  form: { paddingHorizontal: space.page, paddingTop: space.l, gap: space.m },
  defaultRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
