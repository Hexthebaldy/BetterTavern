/** 设置页共用的文字和小规则（模型列表、添加模型、模型详情）。纯逻辑，node --test 可测。 */

import type {
  Credits,
  ModelInfo,
  ModelRoute,
  ProbeCheck,
  Provider,
  RouteWindow,
  WindowSource,
} from "../api/types.ts";
import { i18n, lookup } from "../i18n/index.ts";
import { formatTokens } from "../utils/format.ts";

/** 模型的状态：可用、还没确认、Key 无效 */
export function modelStatusLabel(status: ModelRoute["status"]): string {
  return i18n.t(`models.status.${status}`);
}

/** 状态图标：可用 = 对勾，还没确认 = 虚线方框，Key 无效 = 叉 */
export function statusKind(status: ModelRoute["status"]): "ok" | "untested" | "invalid" {
  return status === "ok" ? "ok" : status === "invalid" ? "invalid" : "untested";
}

/** 服务商的名字：品牌名不翻译；要自己填地址的“自定义兼容端点”按界面语言 */
export function providerName(id: string, providers: Provider[] | undefined): string {
  const provider = providers?.find((p) => p.id === id);
  if (provider?.requires_base_url) return i18n.t("models.customProvider");
  return provider?.display_name ?? id;
}

/** 列表和标题里显示的名字：备注名；没有备注名时，官方模型叫“官方模型”，其他的是模型名 */
export function modelTitle(route: Pick<ModelRoute, "label" | "model"> & { source?: ModelRoute["source"] }): string {
  if (route.label) return route.label;
  return route.source === "platform" ? i18n.t("models.officialName") : route.model;
}

/** Key 那一格：自己的 Key 显示后四位；官方模型不用 Key */
export function keyText(route: Pick<ModelRoute, "source" | "key_last4">): string {
  return route.source === "platform" ? i18n.t("models.officialKey") : `•••• ${route.key_last4}`;
}

/** 列表一行名字下面的小字：模型名（名字不是模型名时）· Key · 上下文 */
export function modelMeta(route: Pick<ModelRoute, "label" | "model" | "source" | "key_last4" | "window">): string {
  const parts = modelTitle(route) === route.model ? [] : [route.model];
  parts.push(keyText(route), formatTokens(route.window.model_window));
  return parts.join(" · ");
}

/** 设置首页导演卡片的第二行：备注名或服务商 · 尾号；官方模型写“官方模型” */
export function directorLine(route: Pick<ModelRoute, "label" | "provider" | "source" | "key_last4">): string {
  if (route.source === "platform") return route.label || i18n.t("models.officialName");
  return `${route.label || route.provider} · ${i18n.t("settings.keyTail", { last4: route.key_last4 })}`;
}

/** 官方模型的余额：“剩余 1480 点，约能写 37 回合” */
export function creditsLine(credits: Pick<Credits, "balance" | "turns_left">): string {
  if (credits.balance <= 0) return i18n.t("models.creditsEmpty");
  return i18n.t("models.creditsLine", { balance: credits.balance, turns: credits.turns_left });
}

/** 这些错误要去“设置 › 模型”处理：还没有导演模型；官方模型的点数用完了 */
export function needsModelSettings(code: string | undefined): boolean {
  return code === "ROUTE_MISSING" || code === "CREDITS_EXHAUSTED";
}

/** 窗口来源的短说明，放在“上下文 128K”后面 */
export function windowSourceLabel(source: WindowSource): string {
  return i18n.t(`models.windowSource.${source}`);
}

/** 窗口来源的完整说明；null 表示不用特别说明 */
export function windowNote(window: RouteWindow): string | null {
  const values = { window: formatTokens(window.model_window) };
  switch (window.source) {
    case "default":
    case "learned":
    case "manual":
      return i18n.t(`models.windowNote.${window.source}`, values);
    default:
      return null;
  }
}

const MANUAL_WINDOWS: { value: string; tokens: number | null }[] = [
  { value: "unknown", tokens: null },
  { value: "8192", tokens: 8192 },
  { value: "32768", tokens: 32768 },
  { value: "131072", tokens: 131072 },
  { value: "1000000", tokens: 1_000_000 },
];

/** 手填窗口的选项；“不知道”就是不填，按 32K 估计 */
export function manualWindowChoices(): { value: string; label: string; tokens: number | null }[] {
  return MANUAL_WINDOWS.map((c) => ({
    ...c,
    label: c.tokens === null ? i18n.t("models.manualUnknown") : formatTokens(c.tokens),
  }));
}

export function manualWindowChoice(tokens: number | null): string {
  return MANUAL_WINDOWS.find((c) => c.tokens === tokens)?.value ?? "unknown";
}

/**
 * 选中的模型要不要让玩家填窗口：服务商的列表或内置资料知道窗口就不用填。
 * 手输的名字不在列表里（列表还没拉、或者是带后缀的名字）时也要填，服务端保存时还会再查一次列表。
 */
export function needsManualWindow(models: ModelInfo[] | null, chosen: string): boolean {
  const name = chosen.trim();
  if (!name) return false;
  const exact = models?.find((m) => m.id === name);
  if (exact) return exact.context_window === null;
  // Hugging Face 的 org/model:后端 后缀：基础模型在列表里有窗口就够了
  const base = name.split(":")[0];
  const viaBase = models?.find((m) => m.id === base);
  return viaBase ? viaBase.context_window === null : true;
}

/** 窗口校验结果的说明 */
export function describeWindow(window: RouteWindow): string[] {
  const lines = [
    i18n.t("models.windowSummary", {
      window: formatTokens(window.model_window),
      source: windowSourceLabel(window.source),
      cap: formatTokens(window.working_cap),
    }),
    i18n.t("models.windowBudget", {
      output: formatTokens(window.max_tokens),
      effective: formatTokens(window.effective_window),
    }),
  ];
  if (window.warnings.includes("WINDOW_CLAMPED")) lines.push(i18n.t("models.windowClamped"));
  return lines;
}

/** 探测各项检查的名字；不认识的检查显示它的 id */
export function checkName(id: string): string {
  return lookup(`probe.checks.${id}`) ?? id;
}

/** 一次探测里通过、失败、跳过各几项 */
export function checkCounts(checks: ProbeCheck[]): { passed: number; failed: number; skipped: number } {
  return {
    passed: checks.filter((c) => c.ok === true).length,
    failed: checks.filter((c) => c.ok === false).length,
    skipped: checks.filter((c) => c.ok === null).length,
  };
}
