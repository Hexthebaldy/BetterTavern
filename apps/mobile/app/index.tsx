/** 入口：恢复登录状态期间显示闪屏，之后按登录状态跳到故事列表或登录页 */

import { Redirect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Logo } from "../src/components/Logo.tsx";
import { Dots } from "../src/components/ui.tsx";
import { useApp } from "../src/state/AppProvider.tsx";
import { font, usePalette } from "../src/theme/index.ts";

export default function Index() {
  const { status } = useApp();
  if (status === "restoring") return <Splash />;
  return <Redirect href={status === "signedIn" ? "/playthroughs" : "/login"} />;
}

/** 闪屏：一竖一横两条浅线，交点处是标志 */
function Splash() {
  const palette = usePalette();
  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <View style={[styles.vertical, { backgroundColor: palette.line }]} />
      <View style={[styles.horizontal, { backgroundColor: palette.line }]} />
      <View style={styles.mark}>
        <Logo size={56} />
      </View>
      <View style={styles.name}>
        <Text style={[styles.title, { color: palette.ink }]}>BetterTavern</Text>
        <Text style={[styles.tagline, { color: palette.mut }]}>FIRST-PERSON FICTION</Text>
      </View>
      <View style={styles.dots} accessibilityRole="progressbar" accessibilityLabel="正在恢复登录状态">
        <Dots cell={8} gap={6} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  vertical: { position: "absolute", left: 32, top: 0, bottom: 0, width: 1 },
  horizontal: { position: "absolute", left: 0, right: 0, top: "45%", height: 1 },
  mark: { position: "absolute", left: 32, top: "45%", marginTop: -56 },
  name: { position: "absolute", left: 32, top: "45%", marginTop: 16, gap: 4 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: -0.8 },
  tagline: { fontFamily: font.mono, fontSize: 12, letterSpacing: 1 },
  dots: { position: "absolute", left: 32, bottom: 80 },
});
