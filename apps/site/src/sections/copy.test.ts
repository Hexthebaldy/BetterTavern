import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { copyCommands, copyLabel, isApplePlatform } from "./copy.ts";

/** 记下调用的假环境 */
function env(opts: { writeText?: "ok" | "reject" | "throw"; execCopy?: boolean | "throw" }) {
  const calls: string[] = [];
  return {
    calls,
    env: {
      writeText:
        opts.writeText === undefined
          ? undefined
          : (text: string) => {
              calls.push(`writeText:${text}`);
              if (opts.writeText === "throw") throw new Error("not allowed");
              return opts.writeText === "ok" ? Promise.resolve() : Promise.reject(new Error("denied"));
            },
      selectAndCopy: () => {
        calls.push("selectAndCopy");
        if (opts.execCopy === "throw") throw new Error("no selection");
        return opts.execCopy ?? false;
      },
    },
  };
}

describe("copyCommands", () => {
  it("剪贴板能用就直接写进去，不去选中", async () => {
    const e = env({ writeText: "ok" });
    assert.equal(await copyCommands("make web", e.env), "ok");
    assert.deepEqual(e.calls, ["writeText:make web"]);
  });

  it("剪贴板拒绝时，选中命令再试一次旧的复制命令", async () => {
    const e = env({ writeText: "reject", execCopy: true });
    assert.equal(await copyCommands("make web", e.env), "ok");
    assert.deepEqual(e.calls, ["writeText:make web", "selectAndCopy"]);
  });

  it("剪贴板接口当场报错，也走退路", async () => {
    const e = env({ writeText: "throw", execCopy: true });
    assert.equal(await copyCommands("make web", e.env), "ok");
  });

  it("没有剪贴板接口（不是 https）时直接走退路", async () => {
    const e = env({ execCopy: true });
    assert.equal(await copyCommands("make web", e.env), "ok");
    assert.deepEqual(e.calls, ["selectAndCopy"]);
  });

  it("旧的复制命令也不行：保留选中，请用户自己按快捷键", async () => {
    assert.equal(await copyCommands("make web", env({ execCopy: false }).env), "sel");
    assert.equal(await copyCommands("make web", env({ writeText: "reject", execCopy: "throw" }).env), "sel");
  });
});

describe("copyLabel", () => {
  it("按结果和平台给出提示", () => {
    assert.equal(copyLabel(null, true), "复制");
    assert.equal(copyLabel("ok", false), "已复制");
    assert.equal(copyLabel("sel", true), "已选中，按 ⌘C 复制");
    assert.equal(copyLabel("sel", false), "已选中，按 Ctrl+C 复制");
  });

  it("苹果的设备提示 ⌘C", () => {
    assert.equal(isApplePlatform("MacIntel"), true);
    assert.equal(isApplePlatform("iPhone"), true);
    assert.equal(isApplePlatform("Win32"), false);
    assert.equal(isApplePlatform("Linux armv8l"), false);
  });
});
