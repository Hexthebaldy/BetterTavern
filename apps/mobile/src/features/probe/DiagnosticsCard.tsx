/**
 * 连接测试页底部的“诊断日志”：手机上的小本子有多少条、导出（系统分享面板）、清空。
 * 导出的是文字：开头几行说明，后面每行一条 JSON，不含故事内容和密钥。
 */

import { useSyncExternalStore } from "react";
import { Share, StyleSheet, Text, View } from "react-native";

import { Button, SectionHeader, useOverlay } from "../../components/ui.tsx";
import { CLIENT_VERSION } from "../../config.ts";
import { diagnostics, exportText } from "../../observability/log.ts";
import { platformLabel } from "../../observability/setup.ts";
import { useApp } from "../../state/AppProvider.tsx";
import { space, usePalette } from "../../theme/index.ts";

export function DiagnosticsCard() {
  const palette = usePalette();
  const overlay = useOverlay();
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
      await Share.share({ message, title: "BetterTavern 诊断日志" });
    } catch {
      overlay.toast("没能打开分享面板", { icon: "alert" });
    }
  };

  const clear = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: "清空诊断日志？",
      message: "手机上保存的记录会全部删掉，服务器上的日志不受影响。",
      confirmLabel: "清空",
      tone: "danger",
    });
    if (ok) diagnostics.clear();
  };

  return (
    <View>
      <SectionHeader title="诊断日志" meta={`${count} 条`} />
      <View style={[styles.card, { backgroundColor: palette.bg2 }]}>
        <Text style={{ fontSize: 14, lineHeight: 22, color: palette.ink2 }}>
          {"手机上保留最近 500 条记录：失败和慢的请求、推送连接的断开和重连、回合状态的变化、App 报错。" +
            "不含故事内容和密钥，只存在这台手机上。出问题时导出来发给开发者，按里面的单号能在服务器日志里找到对应的记录。"}
        </Text>
        <View style={styles.buttons}>
          <Button
            label="导出"
            icon="share"
            onPress={() => void share()}
            disabled={count === 0}
            style={styles.flex}
          />
          <Button
            label="清空"
            icon="trash"
            variant="secondary"
            onGrey
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
  card: { marginHorizontal: space.list, padding: space.l, borderRadius: 24, gap: space.l },
  buttons: { flexDirection: "row", gap: space.s },
  flex: { flex: 1 },
});
