import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SafeStore, type KeyValueStore } from "./local.ts";

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("SafeStore", () => {
  it("存进去的 JSON 原样读出来", () => {
    const store = new SafeStore(() => new MemoryStore());
    const memory = new MemoryStore();
    const same = new SafeStore(() => memory);
    same.write("bt.prefs", { theme: "night" });
    assert.deepEqual(same.read("bt.prefs"), { theme: "night" });
    same.remove("bt.prefs");
    assert.equal(same.read("bt.prefs"), null);
    assert.equal(store.read("missing"), null);
  });

  it("内容坏了当作没存过", () => {
    const memory = new MemoryStore();
    memory.setItem("bt.prefs", "{oops");
    assert.equal(new SafeStore(() => memory).read("bt.prefs"), null);
  });

  it("存储不可用（隐私模式、存满、禁用）时不抛错", () => {
    for (const backing of [() => broken, () => null]) {
      const store = new SafeStore(backing);
      assert.equal(store.read("bt.prefs"), null);
      store.write("bt.prefs", { theme: "night" });
      store.remove("bt.prefs");
    }
    const throwing = new SafeStore(() => {
      throw new Error("SecurityError");
    });
    assert.equal(throwing.read("bt.prefs"), null);
    throwing.write("bt.prefs", 1);
  });
});
