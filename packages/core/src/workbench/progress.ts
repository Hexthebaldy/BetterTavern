/**
 * 工作台页头的进度条和草稿列表上的状态说明（手机和网页共用）。
 *
 * 进度：原创是“需求—方案—动手—检查”四步；查过资料的（作品里的角色）前面多一步“资料”。
 * 手动开始、导入、从仓库打开的草稿没有问卷和方案，只有“动手—检查”。
 */

import type { AgentStatus, Awaiting, DraftOrigin, DraftStage, DraftSummary } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";

export type StepKey = "research" | "questions" | "plan" | "build" | "check";
export type StepState = "done" | "doing" | "todo";
export type Step = { key: StepKey; label: string; state: StepState };

/** 这一步正在做的是哪一步；全部做完时为 null */
function currentStep(stage: DraftStage, agentMade: boolean): StepKey | "all" | null {
  switch (stage) {
    case "start":
      return agentMade ? "questions" : null;
    case "research":
      return "research";
    case "questions":
    case "plan":
    case "build":
    case "check":
      return stage;
    default:
      return "all";
  }
}

export function progressSteps(origin: DraftOrigin, stage: DraftStage, researched: boolean): Step[] {
  const agentMade = origin === "agent";
  const keys: StepKey[] = agentMade
    ? [...(researched || stage === "research" ? (["research"] as const) : []), "questions", "plan", "build", "check"]
    : ["build", "check"];
  const current = currentStep(stage, agentMade);
  const at = current === "all" ? keys.length : current === null ? -1 : keys.indexOf(current);
  return keys.map((key, index) => ({
    key,
    label: i18n.t(`workbench.steps.${key}`),
    state: index < at ? "done" : index === at ? "doing" : "todo",
  }));
}

/** 草稿列表上写明在等什么：“等你回答 6 个问题”“方案等你确认”“改动等你决定”…… */
export function draftStatus(
  draft: Pick<DraftSummary, "agent_status" | "awaiting" | "stage" | "mode" | "unsaved" | "card_id">,
  questions?: number,
): string {
  if (draft.agent_status === "running") return i18n.t("workbench.status.running");
  if (draft.agent_status === "awaiting_user" && draft.awaiting) {
    return awaitingText(draft.awaiting, questions);
  }
  if (draft.stage === "done" || draft.stage === "revise") {
    return draft.unsaved ? i18n.t("workbench.status.unsaved") : i18n.t("workbench.status.saved");
  }
  return draft.mode === "manual" ? i18n.t("workbench.status.manual") : i18n.t("workbench.status.idle");
}

export function awaitingText(awaiting: Awaiting, questions?: number): string {
  if (awaiting.kind === "questions") {
    return questions ? i18n.t("workbench.status.questions", { count: questions }) : i18n.t("workbench.status.questionsAny");
  }
  return i18n.t(`workbench.status.${awaiting.kind}`);
}

/** agent 能不能接着说话：没在跑就行（在等用户时也可以直接说话） */
export function canTalk(status: AgentStatus): boolean {
  return status !== "running";
}
