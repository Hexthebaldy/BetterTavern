/** 外部服务的添加和编辑表单（设置 → 外部服务）共用的小规则。纯逻辑，node --test 可测。 */

import type { NewToolRoute, ToolKind, ToolProvider, ToolRoute, ToolRoutePatch } from "../api/types.ts";

/** 表单里填的东西。编辑时 Key 留空表示不换 */
export type ToolForm = { key: string; baseUrl: string; model: string; voice: string; label: string };

/** 表单的初始值：添加时全空；编辑时 Key 留空，其他填现在的 */
export function toolFormFrom(route?: ToolRoute): ToolForm {
  const voice = route?.params.voice;
  return {
    key: "",
    baseUrl: route?.base_url ?? "",
    model: route?.model ?? "",
    voice: typeof voice === "string" ? voice : "",
    label: route?.label ?? "",
  };
}

/** 能不能保存：要地址、模型名的必须填；要 Key 的添加时必须填，编辑时已经有 Key 就可以不填 */
export function toolFormReady(provider: ToolProvider | undefined, form: ToolForm, route?: ToolRoute): boolean {
  if (!provider) return false;
  const hasKey = form.key.trim() !== "" || !!route?.has_key;
  return (
    (!provider.needs_key || hasKey) &&
    (!provider.needs_base_url || form.baseUrl.trim() !== "") &&
    (!provider.needs_model || form.model.trim() !== "")
  );
}

/** 添加时发的请求体 */
export function newToolRoute(kind: ToolKind, provider: string, form: ToolForm): NewToolRoute {
  const voice = form.voice.trim();
  return {
    kind,
    provider,
    label: form.label.trim() || undefined,
    api_key: form.key.trim() || null,
    base_url: form.baseUrl.trim() || null,
    model: form.model.trim() || null,
    ...(kind === "speech" && voice ? { params: { voice } } : {}),
  };
}

/**
 * 编辑时只发改了的字段：服务端收到地址或模型名就当改过，测试结果清掉、状态回到“还没测试”。
 * retest：换了 Key、地址或模型名，存好以后再测一次（和添加时一样）。patch 是空对象表示什么都没改。
 */
export function toolPatch(route: ToolRoute, form: ToolForm): { patch: ToolRoutePatch; retest: boolean } {
  const patch: ToolRoutePatch = {};
  const key = form.key.trim();
  if (key) patch.api_key = key;
  // 空串表示清掉地址，改用服务商的默认地址
  const baseUrl = form.baseUrl.trim();
  if (baseUrl !== (route.base_url ?? "")) patch.base_url = baseUrl;
  const model = form.model.trim();
  if (model !== (route.model ?? "")) patch.model = model;
  const label = form.label.trim();
  if (label !== route.label) patch.label = label;
  if (route.kind === "speech") {
    // 参数是整个替换的：只动默认声音，其他参数（extra_body 等）照旧
    const voice = form.voice.trim();
    if (voice !== toolFormFrom(route).voice) {
      const { voice: _old, ...rest } = route.params;
      patch.params = voice ? { ...rest, voice } : rest;
    }
  }
  return { patch, retest: "api_key" in patch || "base_url" in patch || "model" in patch };
}
