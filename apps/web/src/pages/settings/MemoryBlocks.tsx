/**
 * 模型详情页“能记住多少”的格子图（同 App 的 MemoryBlocks）：一张灰卡，里面一块白色面板，每个圆点是一格（默认 4K）。
 * 格子怎么分见 @bettertavern/core 的 settings/window.ts。圆点按面板宽度用网格排，16 列。
 */

import { useTranslation } from "react-i18next";

import type { ModelRoute } from "@bettertavern/core/api/types";
import { windowSourceLabel } from "@bettertavern/core/settings/labels";
import { choiceTokens, windowBlocks, type WindowChoice } from "@bettertavern/core/settings/window";
import { formatTokens as k } from "@bettertavern/core/utils/format";

import { cx } from "../../components/controls.tsx";
import styles from "./settings.module.css";

export function MemoryBlocks({ route, choice }: { route: ModelRoute; choice: WindowChoice }) {
  const { t } = useTranslation();
  const w = windowBlocks(route.window.model_window, choiceTokens(choice), route.window.max_tokens);
  const legend = (className: string | undefined, label: string) => (
    <span className={styles.legend}>
      <span className={cx(styles.swatchDot, className)} />
      {label}
    </span>
  );
  return (
    <div className={styles.memory}>
      <div className={styles.memoryTitle}>
        <h4>{t("models.memoryTitle")}</h4>
        <span className={styles.monoSmall}>
          {t("models.memoryContext", {
            window: k(route.window.model_window),
            source: windowSourceLabel(route.window.source),
          })}
        </span>
      </div>
      <div
        className={styles.blocks}
        role="img"
        aria-label={t("models.memoryLabel", {
          window: k(route.window.model_window),
          story: k(w.story),
          output: k(route.window.max_tokens),
          free: k(w.free),
        })}
      >
        {w.blocks.map((b, i) => (
          <span
            key={i}
            className={cx(styles.block, styles[`block-${b}`], i === w.mark && styles.blockMark)}
          />
        ))}
      </div>
      <div className={styles.legends}>
        {legend(styles["block-story"], t("models.memoryStory", { size: k(w.story) }))}
        {legend(styles["block-output"], t("models.memoryOutput", { size: k(route.window.max_tokens) }))}
        {legend(styles["block-free"], t("models.memoryFree", { size: k(w.free) }))}
        {legend(styles.markSwatch, t("models.memoryCompact"))}
      </div>
      <p className={styles.lead}>
        {t("models.memoryNote", {
          unit: k(w.unit),
          window: k(route.window.model_window),
          used: k(w.used),
          output: k(route.window.max_tokens),
          story: k(w.story),
        })}
      </p>
    </div>
  );
}
