/**
 * 对话框：居中的圆角卡片，上方一个圆形图标写清后果，下面并排“取消 / 确认”两个胶囊按钮。
 * 删除用红色，揭示秘密之类的提醒用琥珀色。一般经 useOverlay() 弹出（overlay.tsx），不直接用。
 * 平板上宽不超过 480，居中。
 */

import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { pane } from "@bettertavern/design/layout";

import { onColor, radius, space, type, usePalette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";
import { MODAL_ORIENTATIONS } from "./sheet.tsx";

export type DialogTone = "danger" | "warn" | "default";

type DialogProps = {
  visible: boolean;
  tone?: DialogTone;
  /** 标题上方的圆形图标；删除默认是垃圾桶 */
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
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
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
  const accent = tone === "danger" ? palette.err : tone === "warn" ? palette.warn : palette.ink;
  const accentBg = tone === "danger" ? palette.errBg : tone === "warn" ? palette.warnBg : palette.bg2;
  const shownIcon = icon ?? (tone === "danger" ? "trash" : undefined);
  const confirmBg = tone === "danger" ? palette.err : palette.ink;
  const confirmFg = tone === "danger" ? onColor : palette.bg;
  return (
    <View
      accessibilityRole="alert"
      accessibilityViewIsModal
      style={[styles.dialog, { backgroundColor: palette.card }]}
    >
      <View style={styles.dialogBody}>
        {shownIcon ? (
          <View style={[styles.dialogIcon, { backgroundColor: accentBg }]}>
            <Icon name={shownIcon} size={24} color={accent} />
          </View>
        ) : null}
        <Text style={[styles.dialogTitle, { color: palette.ink }]}>{title}</Text>
        {message ? <Text style={[styles.dialogMessage, { color: palette.ink2 }]}>{message}</Text> : null}
        {children}
      </View>
      <View style={styles.dialogButtons}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [
            styles.dialogButton,
            {
              backgroundColor: pressed ? palette.bg3 : palette.bg2,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
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
            {
              backgroundColor: confirmBg,
              opacity: confirmDisabled ? 0.3 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
        >
          <Text style={[type.button, { color: confirmFg }]}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dialogHost: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: space.page },
  /** 平板上最宽 480（手机屏幕本来就比它窄） */
  dialog: {
    width: "100%",
    maxWidth: pane.dialog,
    borderRadius: radius.sheet,
    paddingTop: 26,
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 18,
  },
  dialogBody: { alignItems: "center", gap: 10 },
  dialogIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  dialogTitle: { fontSize: 20, lineHeight: 28, fontWeight: "700", textAlign: "center" },
  dialogMessage: { fontSize: 14, lineHeight: 22, textAlign: "center" },
  dialogButtons: { flexDirection: "row", gap: space.s },
  dialogButton: { flex: 1, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
});
