/**
 * 注册、验证邮箱、找回密码共用的小部件（同网页端 pages/auth/AuthLayout.tsx、VerifyPage.tsx 里的同名部件）：
 * “已满 18 岁并同意协议”的勾选行、重新发送验证码的倒计时、验证码错误的说明。
 */

import { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { ApiError, describeError } from "@bettertavern/core/api/client";

import { Icon } from "../../components/ui.tsx";
import { usePalette } from "../../theme/index.ts";

/** 协议页面在网页端（/terms、/privacy、/rules）：用当前服务器的地址打开 */
export function legalUrl(serverUrl: string, page: "terms" | "privacy" | "rules"): string {
  return `${serverUrl || "https://bettertavern.com"}/${page}`;
}

export function AgreeRow({
  checked,
  onToggle,
  serverUrl,
}: {
  checked: boolean;
  onToggle: () => void;
  serverUrl: string;
}) {
  const palette = usePalette();
  const link = (page: "terms" | "privacy" | "rules") => (
    <Text
      accessibilityRole="link"
      style={{ color: palette.acc, textDecorationLine: "underline" }}
      onPress={() => void Linking.openURL(legalUrl(serverUrl, page))}
    />
  );
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        hitSlop={10}
        style={[
          styles.box,
          checked
            ? { backgroundColor: palette.acc }
            : { backgroundColor: palette.card, boxShadow: `inset 0 0 0 1.75px ${palette.line2}` },
        ]}
      >
        {checked ? <Icon name="check" size={14} color="#ffffff" strokeWidth={2.6} /> : null}
      </Pressable>
      <Text style={[styles.text, { color: palette.ink2 }]} onPress={onToggle}>
        <Trans i18nKey="auth.agree" components={{ terms: link("terms"), privacy: link("privacy"), rules: link("rules") }} />
      </Text>
    </View>
  );
}

/** 重新发送验证码的倒计时：start() 以后 seconds 从 60 往下数，到 0 才能再发 */
export function useCooldown(initial = 0): { seconds: number; start: () => void } {
  const [seconds, setSeconds] = useState(initial);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return { seconds, start: () => setSeconds(60) };
}

/** 验证码的错误：错太多次作废时说清楚要重发 */
export function codeErrorText(e: unknown, burnt: string): string {
  if (e instanceof ApiError && e.code === "CODE_INVALID" && e.field("attempts_left") === 0) return burnt;
  return describeError(e);
}

/** 只留数字，最多 6 位 */
export function cleanCode(text: string): string {
  return text.replace(/\D/g, "").slice(0, 6);
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  box: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, fontSize: 14, lineHeight: 22 },
});
