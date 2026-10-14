/**
 * 密钥详情页的测试结果：一张灰卡里每项检查一行（通过 / 失败 / 跳过的圆形标记、耗时条），以及测试过的模型列表。
 */

import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ProbedModel, ProbeReport } from "../../api/types.ts";
import { Group, Icon, Notice, SectionHeader } from "../../components/ui.tsx";
import { font, onColor, space, usePalette } from "../../theme/index.ts";
import { formatRelative } from "../../utils/format.ts";
import { CHECK_NAMES, checkCounts } from "./labels.ts";

function Mark({ ok }: { ok: boolean | null }) {
  const palette = usePalette();
  if (ok === null) {
    return (
      <View style={[styles.mark, { backgroundColor: palette.bg3 }]} accessibilityLabel="跳过">
        <Icon name="minus" size={14} color={palette.mut} strokeWidth={2.6} />
      </View>
    );
  }
  return (
    <View
      style={[styles.mark, { backgroundColor: ok ? palette.ok : palette.err }]}
      accessibilityLabel={ok ? "通过" : "失败"}
    >
      <Icon name={ok ? "check" : "cross"} size={14} color={onColor} strokeWidth={2.6} />
    </View>
  );
}

export function ProbeResults({ report }: { report: ProbeReport }) {
  const palette = usePalette();
  const { passed, failed, skipped } = checkCounts(report.checks);
  const slowest = Math.max(1, ...report.checks.map((c) => c.latency_ms ?? 0));
  return (
    <View>
      <SectionHeader title="测试结果" meta={`${passed} 通过 · ${failed} 失败 · ${skipped} 跳过`} />
      <View style={[styles.card, { backgroundColor: palette.bg2 }]}>
        {report.fatal_error ? <Notice message={report.fatal_error} style={{ borderRadius: 22 }} /> : null}
        {report.checks.map((check) => {
          const skippedCheck = check.ok === null;
          return (
            <View
              key={check.name}
              style={[styles.check, check.ok === false ? { backgroundColor: palette.errBg } : null]}
            >
              <Mark ok={check.ok} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={{ fontSize: 15, lineHeight: 22, color: skippedCheck ? palette.mut : palette.ink }}
                >
                  {CHECK_NAMES[check.name] ?? check.name}
                </Text>
                {check.detail ? (
                  <Text
                    style={{
                      fontSize: 12,
                      lineHeight: 17,
                      color: check.ok === false ? palette.err : palette.mut,
                    }}
                  >
                    {check.detail}
                  </Text>
                ) : null}
                {check.latency_ms !== null ? (
                  <View style={[styles.track, { backgroundColor: palette.card }]}>
                    <View
                      style={{
                        width: `${Math.max(4, (check.latency_ms / slowest) * 100)}%`,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: check.ok === false ? palette.err : palette.ink,
                      }}
                    />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.ms, { color: palette.mut }]}>
                {check.latency_ms !== null
                  ? `${check.latency_ms.toLocaleString("en-US")} ms`
                  : skippedCheck
                    ? "跳过"
                    : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function ProbedModels({ models, onPick }: { models: ProbedModel[]; onPick: (model: string) => void }) {
  const palette = usePalette();
  return (
    <View>
      <SectionHeader title="测试过的模型" meta={String(models.length)} />
      <Group inset={16} style={{ marginHorizontal: space.list }}>
        {models.map((m) => {
          const { passed, failed, skipped } = checkCounts(m.checks);
          return (
            <Pressable
              key={m.model}
              accessibilityRole="button"
              accessibilityLabel={`${m.model}，${passed} 项通过，${failed} 项失败，${skipped} 项跳过`}
              onPress={() => onPick(m.model)}
              style={({ pressed }) => [
                styles.probed,
                { backgroundColor: pressed ? palette.bg3 : "transparent" },
              ]}
            >
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontFamily: font.mono, fontSize: 14, color: palette.ink }}
              >
                {m.model}
              </Text>
              <View style={styles.squares}>
                {m.checks.map((c) => (
                  <View
                    key={c.name}
                    style={[
                      styles.square,
                      { backgroundColor: c.ok === null ? palette.line2 : c.ok ? palette.ok : palette.err },
                    ]}
                  />
                ))}
                {m.checks.length === 0 && m.fatal_error ? (
                  <View style={[styles.square, { backgroundColor: palette.err }]} />
                ) : null}
              </View>
              <Text style={{ fontSize: 12, color: palette.mut }}>{formatRelative(m.probed_at)}</Text>
            </Pressable>
          );
        })}
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space.list, padding: 6, borderRadius: 30, gap: 2 },
  mark: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingVertical: space.m,
    paddingHorizontal: 14,
    borderRadius: 22,
  },
  track: { height: 6, borderRadius: 3, marginTop: 6, overflow: "hidden" },
  ms: { width: 64, textAlign: "right", fontFamily: font.mono, fontSize: 11.5 },
  probed: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: space.l },
  squares: { flexDirection: "row", gap: 3 },
  square: { width: 8, height: 8, borderRadius: 4 },
});
