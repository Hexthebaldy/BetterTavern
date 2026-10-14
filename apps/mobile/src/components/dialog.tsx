/**
 * 对话框：顶边 4px 色线写清后果，下面一排“取消 / 确认”。删除用红色，揭示秘密之类的提醒用琥珀色。
 * 一般经 useOverlay() 弹出（overlay.tsx），不直接用。
 */

import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { onColor, space, type, usePalette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";

export type DialogTone = "danger" | "warn" | "default";

type DialogProps = {
  visible: boolean;
  tone?: DialogTone;
  /** 标题上方的 40×40 图标格（琥珀色的锁之类） */
  icon?: IconName;
  title: string;
  message?: string;
  children?: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * 画在当前所在的 Modal 里，而不是自己再开一个 Modal：
   * iOS 上已经有一个 Modal（底部面板）时，从根上再弹的 Modal 显示不出来
   */
  inline?: boolean;
};

export function Dialog({ visible, inline, onCancel, ...card }: DialogProps) {
  const palette = usePalette();
  const body = (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.dialogHost, { backgroundColor: palette.scrim }]}
    >
      <DialogCard {...card} onCancel={onCancel} />
    </KeyboardAvoidingView>
  );
  if (inline) return visible ? <View style={StyleSheet.absoluteFill}>{body}</View> : null;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      {body}
    </Modal>
  );
}

function DialogCard({
  tone = "default",
  icon,
  title,
  message,
  children,
  cancelLabel = "取消",
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: Omit<DialogProps, "visible" | "inline">) {
  const palette = usePalette();
  const edge = tone === "danger" ? palette.err : tone === "warn" ? palette.warn : palette.ink;
  const confirmBg = tone === "danger" ? palette.err : palette.ink;
  const confirmFg = tone === "danger" ? onColor : palette.bg;
  return (
    <View
      accessibilityRole="alert"
      accessibilityViewIsModal
      style={[styles.dialog, { backgroundColor: palette.bg, borderTopColor: edge }]}
    >
      <View style={styles.dialogBody}>
        {icon ? (
          <View
            style={[styles.dialogIcon, { backgroundColor: tone === "warn" ? palette.warnBg : palette.bg2 }]}
          >
            <Icon name={icon} size={22} color={edge} />
          </View>
        ) : null}
        <Text style={[styles.dialogTitle, { color: palette.ink }]}>{title}</Text>
        {message ? <Text style={[styles.dialogMessage, { color: palette.ink2 }]}>{message}</Text> : null}
        {children}
      </View>
      <View style={[styles.dialogButtons, { borderTopColor: palette.line }]}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [
            styles.dialogButton,
            { borderRightWidth: 1, borderRightColor: palette.line },
            { backgroundColor: pressed ? palette.bg2 : palette.bg },
          ]}
        >
          <Text style={[type.button, { fontWeight: "400", color: palette.ink }]}>{cancelLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !!confirmDisabled }}
          disabled={confirmDisabled}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.dialogButton,
            { backgroundColor: confirmBg, opacity: confirmDisabled ? 0.35 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[type.button, { color: confirmFg }]}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dialogHost: { flex: 1, justifyContent: "center", paddingHorizontal: space.page },
  dialog: { borderTopWidth: 4 },
  dialogBody: { paddingHorizontal: space.page, paddingTop: 22, paddingBottom: space.page, gap: 10 },
  dialogIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  dialogTitle: { fontSize: 19, lineHeight: 27, fontWeight: "700" },
  dialogMessage: { fontSize: 14, lineHeight: 22 },
  dialogButtons: { flexDirection: "row", borderTopWidth: 1 },
  dialogButton: { flex: 1, height: 54, alignItems: "center", justifyContent: "center" },
});
