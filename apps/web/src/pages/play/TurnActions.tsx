/**
 * 接在故事流最后一段后面的内容（同 App 的 TurnActions.tsx），跟着正文一起滚动：
 * - 空闲：模型给的选项（圆角灰卡，左边 A / B 字母键；≥ 900 两列，最小高 76，奇数个时最后一项占满一行）；
 * - 开场没写：“开始故事”；失败：错误卡片加重试 / 换个行动（没有模型时去设置）。
 * 生成中、同步中这里什么都没有：状态、“停止”、“自己写…”在底部的操作栏（BottomBar.tsx）。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { describeTurnError } from "@bettertavern/core/api/client";
import type { TurnOption } from "@bettertavern/core/api/types";
import {
  canAct,
  canRetry,
  headTurn,
  isEnded,
  needsOpening,
  type PlayState,
} from "@bettertavern/core/play/turnMachine";

import { Button, cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import styles from "./play.module.css";
import type { PlayControls } from "./usePlaySession.ts";

const KEYS = ["A", "B", "C", "D"];

function OptionRow({
  option,
  index,
  disabled,
  onPick,
}: {
  option: TurnOption;
  index: number;
  disabled: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  // 按下即选中：浅蓝底、2px 蓝色内描边，字母圆变蓝（提交后选项就消失了）
  const [chosen, setChosen] = useState(false);
  return (
    <button
      type="button"
      className={cx(styles.option, chosen && styles.optionOn)}
      disabled={disabled}
      aria-keyshortcuts={KEYS[index]}
      onClick={() => {
        setChosen(true);
        onPick();
      }}
    >
      <span className={styles.key} aria-hidden="true">
        {KEYS[index] ?? "·"}
      </span>
      <span className={styles.optionText}>
        <span className={styles.srOnly}>{t("play.optionLabel", { key: KEYS[index] ?? "", text: "" })}</span>
        {option.text}
      </span>
    </button>
  );
}

export function TurnActions({
  state,
  controls,
  onOpenSettings,
  onPicked,
  twoColumns,
}: {
  state: PlayState;
  controls: PlayControls;
  onOpenSettings: () => void;
  /** 选了一个选项（输入框开着时顺手收起，草稿留着） */
  onPicked: () => void;
  twoColumns: boolean;
}) {
  const { t } = useTranslation();
  if (state.phase === "loading" || state.phase === "load_failed") return null;

  if (state.phase === "failed" && state.error) {
    const routeMissing = state.error.code === "ROUTE_MISSING";
    const opening = state.turns.length === 0;
    return (
      <div className={styles.area}>
        <div className={styles.failCard} role="alert">
          <Icon name="alert" size={20} />
          <span>
            {routeMissing
              ? t("play.noModel")
              : state.pending?.narrative
                ? t("play.unfinished", { error: describeTurnError(state.error) })
                : describeTurnError(state.error)}
          </span>
        </div>
        <div className={styles.failButtons}>
          <Button
            label={opening ? t("common.close") : t("play.changeAction")}
            variant="secondary"
            onClick={controls.dismissError}
          />
          {routeMissing ? (
            <Button label={t("play.goModels")} onClick={onOpenSettings} />
          ) : canRetry(state) ? (
            <Button label={t("common.retry")} icon="retry" onClick={controls.retry} />
          ) : null}
        </div>
      </div>
    );
  }
  if (needsOpening(state)) {
    return (
      <div className={styles.area}>
        <Button
          label={t("start.button")}
          size="lg"
          between
          trailingIcon="arrowRight"
          className={styles.wide}
          onClick={() => controls.submit({ source: "opening" })}
        />
      </div>
    );
  }
  if (state.phase !== "idle") return null;
  const options = headTurn(state)?.options ?? [];
  // 没有选项：结局之后什么都不显示；否则是这一段的选项没补齐，提示玩家在下面自己写
  if (options.length === 0) {
    return isEnded(state) ? null : <p className={cx(styles.area, styles.noOptions)}>{t("play.noOptions")}</p>;
  }
  const enabled = canAct(state);
  return (
    <div className={cx(styles.area, styles.options, twoColumns && styles.optionGrid)}>
      {options.map((option, i) => (
        <OptionRow
          key={option.id}
          option={option}
          index={i}
          disabled={!enabled}
          onPick={() => {
            onPicked();
            controls.submit({ source: "option", option_id: option.id });
          }}
        />
      ))}
    </div>
  );
}
