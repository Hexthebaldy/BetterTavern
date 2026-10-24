/**
 * 模型详情页的测试结果：一个墨线格子里每项检查一行（通过 / 失败 / 跳过的方块标记、耗时条）；通过是深绿、失败是红。
 */

import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import type { ProbeReport } from "@bettertavern/core/api/types";
import { formatRelative } from "@bettertavern/core/utils/format";
import { checkCounts, checkName } from "@bettertavern/core/settings/labels";

import { Icon, Notice, SectionHeader } from "../../components/ui.tsx";
import { comicRadius, comicStroke, font, space, useComic } from "../../theme/index.ts";

function Mark({ ok }: { ok: boolean | null }) {
  const c = useComic();
  const { t } = useTranslation();
  if (ok === null) {
    return (
      <View
        style={[styles.mark, { backgroundColor: c.grey, borderColor: c.ink }]}
        accessibilityLabel={t("models.skipped")}
      >
        <Icon name="minus" size={14} color={c.mut} strokeWidth={2.6} />
      </View>
    );
  }
  return (
    <View
      style={[styles.mark, { backgroundColor: ok ? c.forest : c.err, borderColor: c.ink }]}
      accessibilityLabel={ok ? t("models.passed") : t("models.failed")}
    >
      <Icon name={ok ? "check" : "cross"} size={14} color={c.paper} strokeWidth={2.8} />
    </View>
  );
}

export function ProbeResults({ report }: { report: ProbeReport }) {
  const c = useComic();
  const { t } = useTranslation();
  const { passed, failed, skipped } = checkCounts(report.checks);
  const slowest = Math.max(1, ...report.checks.map((c) => c.latency_ms ?? 0));
  return (
    <View>
      <SectionHeader
        title={t("models.results")}
        meta={t("models.resultsMeta", { passed, failed, skipped, time: formatRelative(report.probed_at) })}
      />
      <View style={[styles.card, { backgroundColor: c.paper, borderColor: c.ink }]}>
        {report.fatal_error ? <Notice message={report.fatal_error} style={{ margin: space.s }} /> : null}
        {report.checks.map((check) => {
          const skippedCheck = check.ok === null;
          return (
            <View
              key={check.name}
              style={[styles.check, check.ok === false ? { backgroundColor: c.errField } : null]}
            >
              <Mark ok={check.ok} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={{ fontSize: 15, lineHeight: 22, color: skippedCheck ? c.mut : c.ink }}
                >
                  {checkName(check.name)}
                </Text>
                {check.detail ? (
                  <Text
                    style={{
                      fontSize: 12,
                      lineHeight: 17,
                      color: check.ok === false ? c.err : c.mut,
                    }}
                  >
                    {check.detail}
                  </Text>
                ) : null}
                {check.latency_ms !== null ? (
                  <View style={[styles.track, { backgroundColor: c.grey }]}>
                    <View
                      style={{
                        width: `${Math.max(4, (check.latency_ms / slowest) * 100)}%`,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: check.ok === false ? c.err : c.ink,
                      }}
                    />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.ms, { color: c.mut }]}>
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
  card: {
    marginHorizontal: 20,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    overflow: "hidden",
  },
  mark: {
    width: 26,
    height: 26,
    borderRadius: comicRadius.tag,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  check: { flexDirection: "row", alignItems: "center", gap: space.m, paddingVertical: space.m, paddingHorizontal: 14 },
  track: { height: 6, borderRadius: 3, marginTop: 6, overflow: "hidden" },
  ms: { width: 64, textAlign: "right", fontFamily: font.mono, fontSize: 11.5 },
});
