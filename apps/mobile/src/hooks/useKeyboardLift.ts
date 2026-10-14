/**
 * 键盘盖住的高度，以及让浮层跟着键盘浮起的动画值（iOS）。阅读页的行动面板和底部面板都用它。
 *
 * 不用 KeyboardAvoidingView：它靠给外层加 paddingBottom 把内容往上推，绝对定位的浮层不吃这个内边距；
 * 而且它收起键盘时走 LayoutAnimation，之后的第一次点按会丢。
 * Android 的窗口会随键盘缩小，这里不用再抬，高度一律报 0。
 */

import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Keyboard, Platform } from "react-native";

export function useKeyboardLift(): { height: number; lift: Animated.Value } {
  const lift = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const move = (to: number, duration: number): void => {
      setHeight(to);
      if (!ios) return;
      // 不用原生驱动：浮层的位置要进布局，按钮的点按区域才跟得上
      Animated.timing(lift, {
        toValue: to,
        duration: duration || 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    };
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      move(e.endCoordinates.height, e.duration),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) =>
      move(0, e.duration),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [lift]);
  return { height: Platform.OS === "ios" ? height : 0, lift };
}
