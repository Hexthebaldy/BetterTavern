/**
 * 接在故事流最后一段后面的内容，跟着正文一起滚动，不固定在屏幕底部挡住正文：
 * - 空闲：模型给的选项（圆角灰卡，左边 A / B 圆形字母键）；
 * - 开场没写：“开始故事”；失败：错误卡片加重试 / 换个行动（没有模型时去设置）。
 * 生成中、同步中这里什么都没有：状态、“停止”、“自己写…”和世界、更多两个按钮都在底部的操作栏（BottomBar.tsx）。
 * 选了选项之后，那一句会立刻作为“我的行动”出现在故事流里。
 *
 * 平板宽屏（theme/layout.ts）选项排成两列，每格最小高 76，奇数个时最后一项占满一行。
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { describeTurnError } from "@bettertavern/core/api/client";
import { optionColumns } from "@bettertavern/design/layout";
import {
  canAct,
  canRetry,
  headTurn,
  isEnded,
  needsOpening,
  type PlayState,
} from "@bettertavern/core/play/turnMachine";

import { Button, Icon, PageSurfaces, useSheetSurfaces } from "../../components/ui.tsx";
import { useLayout } from "../../hooks/useLayout.ts";
import { radius, space, usePalette } from "../../theme/index.ts";
import { OptionRow } from "./ActionParts.tsx";
import { columnWidth } from "./StoryFeed.tsx";
import type { PlayControls } from "./usePlaySession.ts";

/** 平板两列选项的最小高度 */
const GRID_OPTION_HEIGHT = 76;

type Props = {
  state: PlayState;
  controls: PlayControls;
  onOpenSettings: () => void;
  /** 选了一个选项（输入框开着时顺手收起，草稿留着） */
  onPicked: () => void;
  /** 阅读区的宽度（世界状态停靠时比窗口窄）：宽屏两列选项按它算 */
  available: number;
};

export function TurnActions(props: Props) {
  // 放在页面上（不是浮起的面板里）：灰卡用 bg2，卡片里的小圆用白色 card
  return (
    <PageSurfaces>
      <Actions {...props} />
    </PageSurfaces>
  );
}

function Actions({ state, controls, onOpenSettings, onPicked, available }: Props) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const { size: layoutSize } = useLayout();
  const { t } = useTranslation();

  if (state.phase === "loading" || state.phase === "load_failed") return null;

  let content: ReactNode;
  if (state.phase === "failed" && state.error) {
    const routeMissing = state.error.code === "ROUTE_MISSING";
    const opening = state.turns.length === 0;
    content = (
      <View style={styles.column}>
        <View style={[styles.failCard, { backgroundColor: palette.errBg }]} accessibilityRole="alert">
          <Icon name="alert" size={20} color={palette.err} />
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 21, color: palette.err }}>
            {routeMissing
              ? t("play.noModel")
              : state.pending?.narrative
                ? t("play.unfinished", { error: describeTurnError(state.error) })
                : describeTurnError(state.error)}
          </Text>
        </View>
        <View style={styles.buttons}>
          <Button
            label={opening ? t("common.close") : t("play.changeAction")}
            variant="secondary"
            onPress={controls.dismissError}
            style={[styles.flex, { backgroundColor: surfaces.fill }]}
          />
          {routeMissing ? (
            <Button label={t("play.goModels")} onPress={onOpenSettings} style={styles.flex} />
          ) : canRetry(state) ? (
            <Button label={t("common.retry")} icon="retry" onPress={controls.retry} style={styles.flex} />
          ) : null}
        </View>
      </View>
    );
  } else if (needsOpening(state)) {
    content = (
      <Button
        label={t("start.button")}
        trailingIcon="arrowRight"
        between
        onPress={() => controls.submit({ source: "opening" })}
      />
    );
  } else if (state.phase === "idle") {
    const enabled = canAct(state);
    const options = headTurn(state)?.options ?? [];
    // 宽屏两列：选项区的宽度减去中间 6，平分；奇数个时最后一项占满一行
    const inner = columnWidth(available) - space.list * 2;
    const twoColumns = optionColumns(layoutSize) === 2;
    const optionStyle = (i: number): StyleProp<ViewStyle> =>
      twoColumns
        ? {
            width: options.length % 2 === 1 && i === options.length - 1 ? inner : (inner - 6) / 2,
            minHeight: GRID_OPTION_HEIGHT,
          }
        : null;
    // 没有选项：结局之后什么都不显示；否则是这一段的选项没补齐，提示玩家在下面自己写
    if (options.length === 0) {
      if (isEnded(state)) return null;
      content = <Text style={[styles.noOptions, { color: palette.mut }]}>{t("play.noOptions")}</Text>;
    } else {
      content = (
        <View style={twoColumns ? [styles.options, styles.grid] : styles.options}>
          {options.map((option, i) => (
            <OptionRow
              key={option.id}
              option={option}
              index={i}
              disabled={!enabled}
              chosen={false}
              dimmed={false}
              onPress={() => {
                onPicked();
                controls.submit({ source: "option", option_id: option.id });
              }}
              style={optionStyle(i)}
            />
          ))}
        </View>
      );
    }
  } else {
    return null;
  }
  return <View style={styles.area}>{content}</View>;
}

const styles = StyleSheet.create({
  /** 和书名页、开场步骤一样离屏幕 12，卡片里的字母键正好和正文左边对齐 */
  area: { marginHorizontal: space.list, marginTop: space.xs },
  options: { gap: 6 },
  noOptions: { fontSize: 14, lineHeight: 22 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  column: { gap: space.s },
  failCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 14,
    borderRadius: radius.option,
  },
  buttons: { flexDirection: "row", gap: space.s },
  flex: { flex: 1 },
});
