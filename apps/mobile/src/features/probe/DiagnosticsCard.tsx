/**
 * 连接测试页底部的“诊断日志”：手机上的小本子有多少条、导出（系统分享面板）、清空。
 * 导出的是文字：开头几行说明，后面每行一条 JSON，不含故事内容和密钥。
 */

import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Share, StyleSheet, Text, View } from "react-native";

import { diagnostics, exportText } from "@bettertavern/core/observability/log";

import { Button, SectionHeader, useOverlay } from "../../components/ui.tsx";
import { CLIENT_VERSION } from "../../config.ts";
import { platformLabel } from "../../observability/setup.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { comicRadius, comicStroke, space, useComic } from "../../theme/index.ts";

export function DiagnosticsCard() {
  const c = useComic();
  const overlay = useOverlay();
  const { t } = useTranslation();
  const { serverUrl } = useApp();
  const count = useSyncExternalStore(
    (listener) => diagnostics.subscribe(listener),
    () => diagnostics.all().length,
  );

  const share = async (): Promise<void> => {
    const message = exportText(diagnostics.all(), {
      clientVersion: CLIENT_VERSION,
      platform: platformLabel(),
      server: serverUrl,
    });
    try {
      await Share.share({ message, title: t("diagnostics.shareTitle") });
    } catch {
      overlay.toast(t("diagnostics.shareFailed"), { icon: "alert" });
    }
  };

  const clear = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("diagnostics.clearTitle"),
      message: t("diagnostics.clearMessage"),
      confirmLabel: t("diagnostics.clear"),
      tone: "danger",
    });
    if (ok) diagnostics.clear();
  };

  return (
    <View>
      <SectionHeader title={t("diagnostics.title")} meta={t("diagnostics.count", { count })} />
      <View style={[styles.card, { backgroundColor: c.paper, borderColor: c.ink }]}>
        <Text style={{ fontSize: 14, lineHeight: 22, color: c.ink2 }}>{t("diagnostics.about")}</Text>
        <View style={styles.buttons}>
          <Button
            label={t("diagnostics.export")}
            icon="share"
            onPress={() => void share()}
            disabled={count === 0}
            style={styles.flex}
          />
          <Button
            label={t("diagnostics.clear")}
            icon="trash"
            variant="secondary"
            onPress={() => void clear()}
            disabled={count === 0}
            style={styles.flex}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.list,
    padding: space.l,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    gap: space.l,
  },
  buttons: { flexDirection: "row", gap: space.s, paddingBottom: 4 },
  flex: { flex: 1 },
});
