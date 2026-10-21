/**
 * 键盘盖住的高度，以及让浮层跟着键盘浮起的动画值。阅读页的底部操作栏和底部面板都用它。
 *
 * 不用 KeyboardAvoidingView：它靠给外层加 paddingBottom 把内容往上推，绝对定位的浮层不吃这个内边距；
 * 而且它收起键盘时走 LayoutAnimation，之后的第一次点按会丢。
 * Android 也要自己抬：App 是全面屏（edge-to-edge，Expo 现在的 Android 都是）的，弹出键盘时窗口不缩小；
 * 底部面板又是单独的 Modal 窗口，更不会缩。Android 只有键盘已经弹出（DidShow）的事件，键盘出来以后面板再跟上。
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
      // 不用原生驱动：浮层的位置要进布局，按钮的点按区域才跟得上。Android 的事件不带时长
      Animated.timing(lift, {
        toValue: to,
        duration: duration || (ios ? 250 : 160),
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
  return { height, lift };
}
