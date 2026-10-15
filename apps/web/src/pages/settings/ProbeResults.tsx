/** 模型详情页的测试结果（同 App 的 ProbeResults）：每项检查一行（通过 / 失败 / 跳过的圆形标记、耗时条） */

import type { ProbeReport } from "@bettertavern/core/api/types";
import { CHECK_NAMES, checkCounts } from "@bettertavern/core/settings/labels";
import { formatRelative } from "@bettertavern/core/utils/format";

import { cx, Notice } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { SectionHeader } from "./parts.tsx";
import styles from "./settings.module.css";

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return (
      <span className={cx(styles.checkMark, styles.checkSkip)} aria-label="跳过">
        <Icon name="minus" size={14} strokeWidth={2.6} />
      </span>
    );
  }
  return (
    <span
      className={cx(styles.checkMark, ok ? styles.checkOk : styles.checkFail)}
      aria-label={ok ? "通过" : "失败"}
    >
      <Icon name={ok ? "check" : "cross"} size={14} strokeWidth={2.6} />
    </span>
  );
}

export function ProbeResults({ report }: { report: ProbeReport }) {
  const { passed, failed, skipped } = checkCounts(report.checks);
  const slowest = Math.max(1, ...report.checks.map((c) => c.latency_ms ?? 0));
  return (
    <div>
      <SectionHeader
        title="测试结果"
        meta={`${passed} 通过 · ${failed} 失败 · ${skipped} 跳过 · ${formatRelative(report.probed_at)}`}
      />
      <div className={styles.checks}>
        {report.fatal_error ? <Notice message={report.fatal_error} /> : null}
        {report.checks.map((check) => (
          <div key={check.name} className={cx(styles.check, check.ok === false && styles.checkRowFail)}>
            <Mark ok={check.ok} />
            <span className={styles.rowText}>
              <span className={check.ok === null ? styles.muted : undefined}>
                {CHECK_NAMES[check.name] ?? check.name}
              </span>
              {check.detail ? (
                <span className={cx(styles.rowSub, check.ok === false && styles.errText)}>
                  {check.detail}
                </span>
              ) : null}
              {check.latency_ms !== null ? (
                <span className={styles.track}>
                  <span
                    className={cx(styles.trackFill, check.ok === false && styles.trackFail)}
                    style={{ width: `${Math.max(4, (check.latency_ms / slowest) * 100)}%` }}
                  />
                </span>
              ) : null}
            </span>
            <span className={styles.ms}>
              {check.latency_ms !== null
                ? `${check.latency_ms.toLocaleString("en-US")} ms`
                : check.ok === null
                  ? "跳过"
                  : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
