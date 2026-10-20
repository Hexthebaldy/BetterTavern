/**
 * 世界状态面板顶部的两行：整理到第几回合，以及整理时遇到的问题（纯函数，文字按界面语言取）。
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
