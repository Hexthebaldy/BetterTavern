/**
 * 添加模型时“获取模型列表”出错，错误该显示在哪里（两端的添加模型表单共用）：
 * - key：服务商拒绝了 Key（CREDENTIAL_INVALID），或者 Key 本身不合格（VALIDATION_ERROR 指向 api_key）→ Key 输入框；
 * - endpoint：接口地址不允许（ENDPOINT_NOT_ALLOWED），或者地址不合格（VALIDATION_ERROR 指向 base_url）→ 端点输入框；
 * - network：连不上服务器、超时 → 选模型卡，只说原因；
 * - other：服务商不支持列模型、出了别的错 → 选模型卡，并提示可以直接手填模型名。
 * Key 和端点的问题手填模型名解决不了，表单这时不让保存。
 */

import { ApiError } from "../api/client.ts";

export type ListErrorKind = "key" | "endpoint" | "network" | "other";

/** 校验错误指向的字段：业务校验带 field；模型校验带 errors[].loc */
function invalidFields(error: ApiError): string[] {
  const fields: string[] = [];
  const field = error.field("field");
  if (typeof field === "string") fields.push(field);
  const errors = error.field("errors");
  if (Array.isArray(errors)) {
    for (const item of errors) {
      const loc: unknown = typeof item === "object" && item !== null ? (item as { loc?: unknown }).loc : null;
      if (Array.isArray(loc)) fields.push(...loc.filter((part): part is string => typeof part === "string"));
    }
  }
  return fields;
}

export function listErrorKind(error: unknown): ListErrorKind {
  if (!(error instanceof ApiError)) return "other";
  if (error.isNetwork) return "network";
  if (error.code === "CREDENTIAL_INVALID") return "key";
  if (error.code === "ENDPOINT_NOT_ALLOWED") return "endpoint";
  if (error.code === "VALIDATION_ERROR") {
    const fields = invalidFields(error);
    if (fields.includes("api_key")) return "key";
    if (fields.includes("base_url")) return "endpoint";
  }
  return "other";
}
