/**
 * 草稿里的图片（同网页端 pages/workbench/assets.tsx）：带登录凭据的图片、缩略图（带版权标记）、选封面、上传。
 * 有版权或版权不明的图当封面前要确认“仅个人使用”（服务端没带 personal_use 时是 422 IMAGE_LICENSE）。
 * 上传用系统的文件选择（只认图片），原样传给服务端，由服务端去掉照片信息、重新编码。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ImageStyle } from "react-native";

import { describeError } from "@bettertavern/core/api/client";
import type { Asset } from "@bettertavern/core/api/types";

import { Icon, useOverlay } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { usePalette } from "../../theme/index.ts";
import type { DraftSession } from "./useDraftSession.ts";

/** 带登录凭据取的图片；取不到时什么都不画 */
export function BlobImage({ blobId, style }: { blobId: string; style: StyleProp<ImageStyle> }) {
  const { api, authHeaders, serverUrl } = useApp();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    void authHeaders().then(
      (h) => alive && setHeaders(h),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [authHeaders]);
  if (!headers) return null;
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: `${serverUrl}${api.blobPath(blobId)}`, headers }}
      style={style}
      resizeMode="cover"
    />
  );
}

/** 一张图的缩略图；selected 时右上角打勾 */
export function AssetTile({
  asset,
  width,
  selected,
  onPress,
  label,
}: {
  asset: Asset;
  width: number;
  selected?: boolean;
  onPress?: () => void;
  label: string;
}) {
  const palette = usePalette();
  const { t } = useTranslation();
  const height = (width * 4) / 3;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.tile,
        { width, height, backgroundColor: palette.bg3 },
        selected ? { borderWidth: 3, borderColor: palette.acc } : null,
      ]}
    >
      <BlobImage blobId={asset.blob_id} style={{ width: "100%", height: "100%" }} />
      {asset.source !== "generated" && asset.source !== "upload" ? (
        <View style={styles.license}>
          <Text style={styles.licenseText}>{t(`workbench.cover.licenses.${asset.license}`)}</Text>
        </View>
      ) : null}
      {selected ? (
        <View style={[styles.check, { backgroundColor: palette.acc }]}>
          <Icon name="check" size={13} color="#fff" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** 换封面、去掉封面、上传图片；成功后换上服务端返回的草稿 */
export function useCoverActions(draftId: string, session: DraftSession) {
  const { api } = useApp();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const setDraft = session.setDraft;

  const pick = useCallback(
    async (asset: Asset): Promise<boolean> => {
      let personalUse = asset.personal_use;
      if ((asset.license === "copyrighted" || asset.license === "unknown") && !personalUse) {
        const ok = await overlay.confirm({
          title: t("workbench.cover.licenseTitle"),
          message: t("workbench.cover.licenseMessage"),
          confirmLabel: t("workbench.cover.licenseConfirm"),
          tone: "warn",
          icon: "image",
        });
        if (!ok) return false;
        personalUse = true;
      }
      try {
        setDraft(await api.workbench.setCover(draftId, asset.id, personalUse));
        return true;
      } catch (e) {
        overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
        return false;
      }
    },
    [api, draftId, overlay, setDraft, t],
  );

  const remove = useCallback(async () => {
    try {
      setDraft(await api.workbench.setCover(draftId, null));
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    }
  }, [api, draftId, overlay, setDraft, t]);

  /** 选一张图上传，直接当封面（自己上传的不用确认版权）；取消了返回 false */
  const upload = useCallback(async (): Promise<boolean> => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["image/png", "image/jpeg", "image/webp"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    const file = picked.canceled ? undefined : picked.assets[0];
    if (!file) return false;
    try {
      const asset = await api.workbench.uploadAsset(draftId, new File(file.uri));
      setDraft(await api.workbench.setCover(draftId, asset.id));
      return true;
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
      return false;
    }
  }, [api, draftId, overlay, setDraft, t]);

  return { pick, remove, upload };
}

export type CoverActions = ReturnType<typeof useCoverActions>;

const styles = StyleSheet.create({
  tile: { borderRadius: 12, overflow: "hidden" },
  license: {
    position: "absolute",
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  licenseText: { color: "#fff", fontSize: 10.5, lineHeight: 16 },
  check: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
