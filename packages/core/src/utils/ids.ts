/**
 * 幂等键：只要求同一用户下不重复，不需要密码学强度。
 * 有 crypto.randomUUID 就用（新版 Hermes / Node），没有就用时间戳加随机数拼一个 UUID 形状的串。
 */

export function newIdempotencyKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const hex = (n: number): string =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const time = Date.now().toString(16).padStart(12, "0").slice(-12);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}
