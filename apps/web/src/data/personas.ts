/**
 * 人设库的查询（docs/personas.md）：设置里的人设一格和人设页、开新故事和剧本设置里选人设、
 * 阅读页页头和存档列表按存档的 persona_id 找头像，都读这一份。
 */

import { useQuery } from "@tanstack/react-query";

import type { Persona } from "@bettertavern/core/api/types";
import { personaOf } from "@bettertavern/core/scenario/persona";

import { useApp } from "../state/AppProvider.tsx";

export const personasKey = ["personas"] as const;

export function usePersonas() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: personasKey,
    queryFn: () => api.personas.list(),
    enabled: status === "signedIn",
  });
}

/** 存档开局时用的人设（找不到就是 undefined：临时填的、删掉了、还没加载出来） */
export function usePersona(id: string | null | undefined): Persona | undefined {
  const personas = usePersonas();
  return personaOf(id, personas.data);
}
