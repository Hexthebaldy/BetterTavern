/**
 * 世界状态面板顶部的两行：整理到第几回合，以及整理时遇到的问题（纯函数，文字按界面语言取）；
 * 以及面板开着时什么时候再取一次。
 * 世界状态由后台整理，可能比最新一回合落后；整理失败两次的回合会被跳过（docs/agent-runtime.md 第 4 节）。
 */

import type { WorldView } from "../api/types.ts";
import { i18n, lookup } from "../i18n/index.ts";

export function worldProgress(view: Pick<WorldView, "state_seq">): string {
  return view.state_seq >= 0 ? i18n.t("world.asOf", { seq: view.state_seq }) : i18n.t("world.asOfOpening");
}

export function worldIssue(view: Pick<WorldView, "state_issue">): string | null {
  const issue = view.state_issue;
  if (issue === null) return null;
  const reason =
    (issue.reason
      ? (lookup(`world.issueReason.${issue.reason}`) ?? lookup(`errors.reason.${issue.reason}`))
      : null) ?? i18n.t("world.issueReason.unknown");
  return i18n.t(issue.kind === "failed" ? "world.issueFailed" : "world.issueSkipped", {
    seq: issue.seq,
    reason,
  });
}

/** 后台还在整理时，面板每隔这么久再取一次 */
export const WORLD_REFRESH_MS = 4000;

/**
 * 面板开着时，过多久再取一次世界状态；不用再取时返回 null。
 * 后台还没整理到最新一段就过一会儿再取；最新的那段整理失败了要等下一回合再试，这时不用一直取。
 * 最新一段变了（写完新的一段、回退）由面板自己重新取，不归这里管。
 */
export function worldRefreshDelay(
  view: Pick<WorldView, "state_seq" | "state_issue"> | null | undefined,
  headSeq: number | null,
): number | null {
  if (!view || headSeq === null || view.state_seq >= headSeq) return null;
  const issue = view.state_issue;
  if (issue?.kind === "failed" && issue.seq === view.state_seq + 1) return null;
  return WORLD_REFRESH_MS;
}
