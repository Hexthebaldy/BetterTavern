/**
 * 模型详情页的测试结果：一张灰卡里每项检查一行（通过 / 失败 / 跳过的圆形标记、耗时条）。
 */

import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import type { ProbeReport } from "@bettertavern/core/api/types";
import { formatRelative } from "@bettertavern/core/utils/format";
import { checkCounts, checkName } from "@bettertavern/core/settings/labels";

import { Icon, Notice, SectionHeader } from "../../components/ui.tsx";
import { font, onColor, space, usePalette } from "../../theme/index.ts";

function Mark({ ok }: { ok: boolean | null }) {
  const palette = usePalette();
  const { t } = useTranslation();
  if (ok === null) {
    return (
      <View style={[styles.mark, { backgroundColor: palette.bg3 }]} accessibilityLabel={t("models.skipped")}>
        <Icon name="minus" size={14} color={palette.mut} strokeWidth={2.6} />
      </View>
    );
  }
  return (
    <View
      style={[styles.mark, { backgroundColor: ok ? palette.ok : palette.err }]}
      accessibilityLabel={ok ? t("models.passed") : t("models.failed")}
    >
      <Icon name={ok ? "check" : "cross"} size={14} color={onColor} strokeWidth={2.6} />
    </View>
  );
}

export function ProbeResults({ report }: { report: ProbeReport }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const { passed, failed, skipped } = checkCounts(report.checks);
  const slowest = Math.max(1, ...report.checks.map((c) => c.latency_ms ?? 0));
  return (
    <View>
      <SectionHeader
        title={t("models.results")}
        meta={t("models.resultsMeta", { passed, failed, skipped, time: formatRelative(report.probed_at) })}
      />
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
                  {checkName(check.name)}
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
                    ? t("models.skipped")
                    : ""}
              </Text>
            </View>
          );
        })}
      </View>
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
});
