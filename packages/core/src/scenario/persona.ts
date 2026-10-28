/**
 * 人设库（docs/personas.md）：开新故事和剧本设置里“你扮演谁”先选哪个，以及选择拼回接口字段的规则。
 * 先选哪个和服务端一样（services/playthrough_service.py 的 _protagonist）。
 */

import type { Persona, ScenarioSetup } from "../api/types.ts";

export const PERSONA_NAME_MAX = 40;
export const PERSONA_DESCRIPTION_MAX = 2000;
/** 剧本设置里默认主角的描述上限（选人设时服务端存的副本也截到这么长） */
export const SETUP_SUMMARY_MAX = 400;

/** “你扮演谁”：人设库里的一个，或者自己填（开新故事时不进人设库，除非勾选“存进人设库”） */
export type ProtagonistChoice = { kind: "persona"; id: string } | { kind: "custom"; name: string; summary: string };

export const BLANK: ProtagonistChoice = { kind: "custom", name: "", summary: "" };

export function personaOf(id: string | null | undefined, personas: readonly Persona[] | undefined): Persona | undefined {
  return id ? personas?.find((p) => p.id === id) : undefined;
}

/** 剧本设置里的默认人设；没选人设、但有旧版 App 写的默认主角时当作自己填的；都没有就空着 */
export function setupChoice(setup: ScenarioSetup | undefined, personas: readonly Persona[]): ProtagonistChoice {
  const bound = personaOf(setup?.persona_id, personas);
  if (bound) return { kind: "persona", id: bound.id };
  if (setup?.protagonist.name) {
    return { kind: "custom", name: setup.protagonist.name, summary: setup.protagonist.summary };
  }
  return BLANK;
}

/** 开新故事时先选哪个：剧本选的人设 → 剧本里旧版 App 写的默认主角 → 默认人设 → 空着自己填 */
export function startChoice(setup: ScenarioSetup | undefined, personas: readonly Persona[]): ProtagonistChoice {
  const choice = setupChoice(setup, personas);
  if (choice.kind === "persona" || choice.name) return choice;
  const fallback = personas.find((p) => p.is_default);
  return fallback ? { kind: "persona", id: fallback.id } : BLANK;
}

/** 选的是谁（底部摘要；空串表示还没选也没填名字） */
export function choiceName(choice: ProtagonistChoice, personas: readonly Persona[]): string {
  return choice.kind === "persona" ? (personaOf(choice.id, personas)?.name ?? "") : choice.name.trim();
}

/** 开新故事的请求字段 */
export function startFields(
  choice: ProtagonistChoice,
): { persona_id: string } | { protagonist: { name: string; summary: string } } {
  if (choice.kind === "persona") return { persona_id: choice.id };
  return { protagonist: { name: choice.name.trim(), summary: choice.summary.trim() } };
}

/** 剧本设置的两个字段：选人设时 protagonist 写成它的副本（服务端也会写），自己填的就是默认主角 */
export function setupFields(
  choice: ProtagonistChoice,
  personas: readonly Persona[],
): Pick<ScenarioSetup, "persona_id" | "protagonist"> {
  if (choice.kind === "persona") {
    const persona = personaOf(choice.id, personas);
    return {
      persona_id: choice.id,
      protagonist: {
        name: persona?.name ?? "",
        summary: (persona?.description ?? "").slice(0, SETUP_SUMMARY_MAX),
      },
    };
  }
  return { persona_id: null, protagonist: { name: choice.name.trim(), summary: choice.summary.trim() } };
}

/** 名字的第一个字：没有头像时画在圆里 */
export function initialOfName(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}
