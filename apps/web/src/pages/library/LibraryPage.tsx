/**
 * “剧本”（/scenarios）和“角色”（/characters，另一段是世界书 /lorebooks）两个一级页
 * （ScenariosPage.tsx、CharactersPage.tsx、LorebooksPage.tsx），
 * 以及旧地址 /library（?tab=cards 是角色卡）的跳转。
 */

import { Navigate, useSearchParams } from "react-router";

export { CharactersPage } from "./CharactersPage.tsx";
export { LorebooksPage } from "./LorebooksPage.tsx";
export { ScenariosPage } from "./ScenariosPage.tsx";

/** 旧地址 /library 和 /library?tab=cards */
export function LibraryRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={params.get("tab") === "cards" ? "/characters" : "/scenarios"} replace />;
}
