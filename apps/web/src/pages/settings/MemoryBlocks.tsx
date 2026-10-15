/**
 * 模型详情页“能记住多少”的格子图（同 App 的 MemoryBlocks）：一张灰卡，里面一块白色面板，每个圆点是一格（默认 4K）。
 * 格子怎么分见 @bettertavern/core 的 settings/window.ts。圆点按面板宽度用网格排，16 列。
 */

import type { ModelRoute } from "@bettertavern/core/api/types";
import { WINDOW_SOURCE } from "@bettertavern/core/settings/labels";
import { choiceTokens, windowBlocks, type WindowChoice } from "@bettertavern/core/settings/window";
import { formatTokens as k } from "@bettertavern/core/utils/format";

import { cx } from "../../components/controls.tsx";
import styles from "./settings.module.css";

export function MemoryBlocks({ route, choice }: { route: ModelRoute; choice: WindowChoice }) {
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
        <h4>能记住多少</h4>
        <span className={styles.monoSmall}>
          上下文 {k(route.window.model_window)} · {WINDOW_SOURCE[route.window.source]}
        </span>
      </div>
      <div
        className={styles.blocks}
        role="img"
        aria-label={`上下文 ${k(route.window.model_window)}，故事 ${k(w.story)}，每轮输出 ${k(route.window.max_tokens)}，不使用 ${k(w.free)}`}
      >
        {w.blocks.map((b, i) => (
          <span
            key={i}
            className={cx(styles.block, styles[`block-${b}`], i === w.mark && styles.blockMark)}
          />
        ))}
      </div>
      <div className={styles.legends}>
        {legend(styles["block-story"], `故事 ${k(w.story)}`)}
        {legend(styles["block-output"], `每轮输出 ${k(route.window.max_tokens)}`)}
        {legend(styles["block-free"], `不使用 ${k(w.free)}`)}
        {legend(styles.markSwatch, "开始压缩")}
      </div>
      <p className={styles.lead}>
        每个圆点是 {k(w.unit)}。模型最多能读 {k(route.window.model_window)}，你给导演 {k(w.used)}：每轮最多写{" "}
        {k(route.window.max_tokens)}，剩下约 {k(w.story)} 用来记前情和世界状态。
      </p>
    </div>
  );
}
