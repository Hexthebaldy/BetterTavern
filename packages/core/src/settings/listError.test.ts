import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, networkError } from "../api/client.ts";
import { listErrorKind } from "./listError.ts";

function problem(status: number, code: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError("x", {
    status,
    code,
    retryable: false,
    problem: { type: "about:blank", title: "x", status, code, retryable: false, ...extra },
  });
}

describe("获取模型列表的错误显示在哪", () => {
  it("Key 被拒、Key 不合格：显示在 Key 上", () => {
    assert.equal(listErrorKind(problem(424, "CREDENTIAL_INVALID")), "key");
    assert.equal(listErrorKind(problem(422, "VALIDATION_ERROR", { field: "api_key" })), "key");
    assert.equal(
      listErrorKind(
        problem(422, "VALIDATION_ERROR", { errors: [{ loc: ["body", "api_key"], msg: "too long" }] }),
      ),
      "key",
    );
  });

  it("接口地址不允许、地址不合格：显示在端点上", () => {
    assert.equal(listErrorKind(problem(422, "ENDPOINT_NOT_ALLOWED", { reason: "private" })), "endpoint");
    assert.equal(listErrorKind(problem(422, "VALIDATION_ERROR", { field: "base_url" })), "endpoint");
  });

  it("连不上、超时：只说原因", () => {
    assert.equal(listErrorKind(networkError(new TypeError("Failed to fetch"), false)), "network");
    assert.equal(listErrorKind(networkError(new Error("timeout"), true)), "network");
  });

  it("服务商的其他错误、别的校验错误、不认识的错误：仍提示可以手填模型名", () => {
    assert.equal(listErrorKind(problem(502, "PROVIDER_ERROR", { error_class: "unknown" })), "other");
    assert.equal(listErrorKind(problem(422, "VALIDATION_ERROR", { field: "provider" })), "other");
    assert.equal(listErrorKind(problem(429, "RATE_LIMITED")), "other");
    assert.equal(listErrorKind(new Error("boom")), "other");
  });
});
