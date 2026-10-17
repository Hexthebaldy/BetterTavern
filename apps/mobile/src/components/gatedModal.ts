/**
 * 自己带 <Modal> 的组件（Sheet、非 inline 的 Dialog、平板的 CardMenu）用 useGatedModal 决定 <Modal> 什么时候挂上、
 * 什么时候拿掉。iOS 上经 modalGate 排队（原因见 modalGate.ts）：
 * - 打开：没有正在收回的 <Modal> 才挂上；有就等它们被 iOS 收回；
 * - 关闭：先登记“正在收回”；有收起动画的（Sheet）播完动画，再把 <Modal> 的 visible 设为 false；
 *   收到 onDismiss（iOS 确认已经收回）才拿掉 <Modal>、撤销登记；
 * - 收回中又要打开：等这次收回完成再重新打开。
 * Android 没有这个限制，<Modal> 也没有 onDismiss：打开直接挂上，关闭（动画播完）直接拿掉。
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { diagnostics } from "@bettertavern/core/observability/log";

import { ModalGate } from "./modalGate.ts";

const IOS = Platform.OS === "ios";

export const modalGate = new ModalGate({
  onTimeout: (id, waitedMs) => diagnostics.warn("modal.dismiss_timeout", { modal: id, waited_ms: waitedMs }),
});

/**
 * closed 没有 <Modal>；waiting 要打开，在等别的 <Modal> 收回；shown 已挂上；
 * closing 要关，在播收起动画（<Modal> 还在）；dismissing <Modal> 的 visible 已是 false，等 iOS 收回
 */
type Phase = "closed" | "waiting" | "shown" | "closing" | "dismissing";

export type GatedModal = {
  /** 要不要渲染 <Modal> */
  mounted: boolean;
  /** 传给 <Modal visible> */
  visible: boolean;
  /** 已经挂上、没在关：开场动画从这时开始 */
  shown: boolean;
  /** 传给 <Modal onDismiss> */
  onDismiss: () => void;
};

let nextModalId = 1;

/**
 * open：调用方想不想让它显示（Sheet 的 visible、Dialog 的 visible 等）。
 * name：诊断日志里的名字。animateOut：收起动画，播完调用 done；不传就是没有收起动画。
 */
export function useGatedModal(
  open: boolean,
  name: string,
  animateOut?: (done: () => void) => void,
): GatedModal {
  const [phase, setPhase] = useState<Phase>("closed");
  const [id] = useState(() => `${name}#${nextModalId++}`);
  const openRef = useRef(open);
  openRef.current = open;
  const animateOutRef = useRef(animateOut);
  animateOutRef.current = animateOut;

  // 收回完成（onDismiss，或保底超时）：还想显示就重新排队，否则拿掉 <Modal>
  const settle = useCallback(() => {
    setPhase((p) => (p === "closing" || p === "dismissing" ? (openRef.current ? "waiting" : "closed") : p));
  }, []);

  // 用 layout effect：关闭在这次提交里就登记，紧接着要 present 的 <Modal> 一定能看到
  useLayoutEffect(() => {
    if (open && phase === "closed") {
      setPhase("waiting");
    } else if (!open && phase === "waiting") {
      setPhase("closed");
    } else if (!open && phase === "shown") {
      if (IOS) modalGate.beginDismiss(id, settle);
      const after = IOS ? "dismissing" : "closed";
      const animate = animateOutRef.current;
      if (animate) {
        setPhase("closing");
        animate(() => setPhase((p) => (p === "closing" ? after : p)));
      } else {
        setPhase(after);
      }
    }
  }, [open, phase, id, settle]);

  // 排队：没有正在收回的 <Modal> 时挂上
  useLayoutEffect(() => {
    if (phase !== "waiting") return;
    if (!IOS) {
      setPhase("shown");
      return;
    }
    return modalGate.whenNoneDismissing(() => setPhase((p) => (p === "waiting" ? "shown" : p)));
  }, [phase]);

  const onDismiss = useCallback(() => {
    modalGate.endDismiss(id);
    settle();
  }, [id, settle]);

  return {
    mounted: phase === "shown" || phase === "closing" || phase === "dismissing",
    visible: phase === "shown" || phase === "closing",
    shown: phase === "shown",
    onDismiss,
  };
}
