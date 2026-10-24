/**
 * 对话框（漫画风）：居中的白底 2.5 墨线格子，圆角 18、投影 6；标题、说明靠左，下面并排“取消 / 确认”两个按钮，
 * 写清后果的图标放在确认按钮里。删除的确认按钮是红底，揭示秘密之类的提醒标题前加琥珀色图标。
 * 一般经 useOverlay() 弹出（overlay.tsx），不直接用。
 * 平板上宽不超过 480，居中。
 * 非 inline 时自己带一个 Modal，什么时候挂上、拿掉由 useGatedModal 决定（gatedModal.ts）：
 * iOS 上等别的 Modal 被收回才挂上；关闭时 visible 先变 false（淡出），等 iOS 确认收回才拿掉。
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from "react-native";

import { pane } from "@bettertavern/design/layout";

import {
  comicDepth,
  comicRadius,
  comicStroke,
  ctype,
  hardShadow,
  space,
  useComic,
} from "../theme/index.ts";
import { Button } from "./buttons.tsx";
import { useGatedModal } from "./gatedModal.ts";
import { Icon, type IconName } from "./icons.tsx";
import { MODAL_ORIENTATIONS } from "./sheet.tsx";

export type DialogTone = "danger" | "warn" | "default";

type DialogProps = {
  visible: boolean;
  tone?: DialogTone;
  /** 确认按钮里的图标；删除默认是垃圾桶 */
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
  const c = useComic();
  const modal = useGatedModal(visible && !inline, "dialog");
  const body = (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.dialogHost, { backgroundColor: c.scrim }]}
    >
      <DialogCard {...card} onCancel={onCancel} />
    </KeyboardAvoidingView>
  );
  if (inline) return visible ? <View style={StyleSheet.absoluteFill}>{body}</View> : null;
  if (!modal.mounted) return null;
  return (
    <Modal
      transparent
      visible={modal.visible}
      animationType="fade"
      onRequestClose={onCancel}
      onDismiss={modal.onDismiss}
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
  cancelLabel,
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: Omit<DialogProps, "visible" | "inline">) {
  const c = useComic();
  const { t } = useTranslation();
  const shownIcon = icon ?? (tone === "danger" ? "trash" : undefined);
  return (
    <View
      accessibilityRole="alert"
      accessibilityViewIsModal
      style={[
        styles.dialog,
        { backgroundColor: c.paper, borderColor: c.ink, boxShadow: hardShadow(c.ink, comicDepth.dialog) },
      ]}
    >
      <View style={styles.dialogBody}>
        <View style={styles.titleRow}>
          {tone === "warn" ? <Icon name="alert" size={22} color={c.warn} /> : null}
          <Text style={[ctype.sheetTitle, { flex: 1, color: c.ink }]}>{title}</Text>
        </View>
        {message ? <Text style={[styles.dialogMessage, { color: c.ink2 }]}>{message}</Text> : null}
        {children}
      </View>
      <View style={styles.dialogButtons}>
        <Button
          label={cancelLabel ?? t("common.cancel")}
          variant="secondary"
          onPress={onCancel}
          style={styles.dialogButton}
        />
        <Button
          label={confirmLabel}
          variant={tone === "danger" ? "dangerSolid" : "primary"}
          icon={shownIcon}
          disabled={confirmDisabled}
          onPress={onConfirm}
          style={styles.dialogButton}
        />
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
    borderRadius: comicRadius.dialog,
    borderWidth: comicStroke.frame,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 16,
  },
  dialogBody: { gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.s },
  dialogMessage: { fontSize: 14.5, lineHeight: 23 },
  dialogButtons: { flexDirection: "row", gap: space.m },
  dialogButton: { flex: 1, minHeight: 46, paddingHorizontal: space.m },
});
