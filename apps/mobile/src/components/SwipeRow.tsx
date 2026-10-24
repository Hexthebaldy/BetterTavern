/**
 * 左滑露出操作的列表卡片（重命名、删除）：卡片往左移，右边露出两个白底墨线的方块按钮（删除是红底）。
 * 左滑到底也不会直接删除，操作仍然要经过确认。
 * 长按和读屏的“操作”菜单给出同样的选项，照顾不习惯左滑的人。同一时间只有一行是打开的。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { comicRadius, comicStroke, onColor, useComic } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";

export type SwipeAction = {
  key: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  onPress: () => void;
};

const ACTION_WIDTH = 72;
const GAP = 8;

let closeOpenRow: (() => void) | null = null;

export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const c = useComic();
  const width = actions.length * (ACTION_WIDTH + GAP);
  const x = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const [open, setOpen] = useState(false);

  const settle = (opening: boolean): void => {
    offset.current = opening ? -width : 0;
    setOpen(opening);
    Animated.spring(x, { toValue: offset.current, useNativeDriver: true, bounciness: 0 }).start();
    if (opening) {
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
    } else if (closeOpenRow === close) {
      closeOpenRow = null;
    }
  };
  const close = (): void => settle(false);
  const settleRef = useRef(settle);
  settleRef.current = settle;

  useEffect(
    () => () => {
      if (closeOpenRow === close) closeOpenRow = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          x.setValue(Math.min(0, Math.max(-width - 24, offset.current + g.dx)));
        },
        onPanResponderRelease: (_, g) => {
          const next = offset.current + g.dx;
          settleRef.current(next < -width / 2 || g.vx < -0.5);
        },
        onPanResponderTerminate: () => settleRef.current(offset.current < 0),
      }),
    [x, width],
  );

  return (
    <View
      style={styles.root}
      accessibilityActions={actions.map((a) => ({ name: a.key, label: a.label }))}
      onAccessibilityAction={(e) => actions.find((a) => a.key === e.nativeEvent.actionName)?.onPress()}
    >
      {/* 卡片没滑开时把下面的按钮藏起来，不然会从卡片的圆角边缘透出一圈颜色 */}
      <Animated.View
        style={[
          styles.actions,
          {
            width,
            opacity: x.interpolate({ inputRange: [-24, 0], outputRange: [1, 0], extrapolate: "clamp" }),
          },
        ]}
        importantForAccessibility="no-hide-descendants"
      >
        {actions.map((a) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            onPress={() => {
              close();
              a.onPress();
            }}
            style={({ pressed }) => [
              styles.action,
              {
                borderColor: c.ink,
                backgroundColor: a.danger ? c.danger : pressed ? c.grey : c.paper,
              },
            ]}
          >
            <Icon name={a.icon} color={a.danger ? onColor : c.ink} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: a.danger ? onColor : c.ink }}>{a.label}</Text>
          </Pressable>
        ))}
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {children}
        {/* 打开时点行本身只是收起，不进入详情 */}
        {open ? <Pressable onPress={close} style={StyleSheet.absoluteFill} accessible={false} /> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden" },
  actions: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: GAP,
    paddingLeft: GAP,
  },
  action: {
    width: ACTION_WIDTH,
    borderRadius: comicRadius.frame,
    borderWidth: comicStroke.frame,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
});
