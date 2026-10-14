/** 角色卡头像：图片要带访问令牌才能取，没有图片时显示名字的第一个字 */

import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useApp } from "../state/AppProvider.tsx";
import { usePalette } from "../theme/index.ts";

export function Avatar({ blobId, name, size = 44 }: { blobId: string | null; name: string; size?: number }) {
  const { api, authHeaders, serverUrl } = useApp();
  const palette = usePalette();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!blobId) return;
    let alive = true;
    authHeaders()
      .then((h) => {
        if (alive) setHeaders(h);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [blobId, authHeaders]);

  const box = { width: size, height: size, borderRadius: size / 5 };
  if (blobId && headers && !failed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: `${serverUrl}${api.scenarios.blobPath(blobId)}`, headers }}
        onError={() => setFailed(true)}
        style={[box, { backgroundColor: palette.accentSoft }]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={[box, styles.fallback, { backgroundColor: palette.accentSoft }]}>
      <Text style={{ color: palette.accent, fontSize: size * 0.42, fontWeight: "600" }}>
        {[...name][0] ?? "?"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});
