// 在一个临时的 git 仓库里跑 deploy-gate.sh，看每天的定时部署对各种情况的判断
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./deploy-gate.sh", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "deploy-gate-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.email", "test@example.test");
git("config", "user.name", "test");

let serial = 0;
function commit(path = "notes.txt") {
  serial += 1;
  const file = join(dir, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, String(serial));
  git("add", "-A");
  git("commit", "-q", "-m", `change ${serial}`);
  return git("rev-parse", "HEAD");
}

const gate = (...args) => {
  const run = spawnSync("bash", [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
  return { status: run.status, word: run.stdout.trim() };
};
const decide = (...args) => {
  const { status, word } = gate(...args);
  assert.equal(status, 0);
  return word;
};

const first = commit();
const second = commit("apps/web/page.tsx");
const third = commit();
const withMigration = commit("apps/server/migrations/versions/0001_add.py");
const afterMigration = commit();

describe("deploy-gate", () => {
  it("线上已经是这个提交，或者比它新：不用部署", () => {
    assert.equal(decide(second, second), "none");
    assert.equal(decide(third, second), "none");
  });

  it("有新提交、没有迁移：可以上", () => {
    assert.equal(decide(first, third), "go");
  });

  it("线上和目标之间有迁移：等人手动，哪怕迁移不在最后一个提交里", () => {
    assert.equal(decide(third, withMigration), "migration");
    assert.equal(decide(third, afterMigration), "migration");
    assert.equal(decide(withMigration, afterMigration), "go");
  });

  it("回滚以后不再把回滚掉的版本上回去，有了新提交才继续", () => {
    assert.equal(decide(first, third, third), "held");
    assert.equal(decide(first, second, third), "held");
    assert.equal(decide(first, third, second), "go");
  });

  it("deploy-hold 里的提交号是短的也认", () => {
    assert.equal(decide(first, third, third.slice(0, 12)), "held");
    assert.equal(decide(first.slice(0, 12), third), "go");
  });

  it("不认识线上的提交：报错，不当作可以上", () => {
    const { status, word } = gate("dev", third);
    assert.notEqual(status, 0);
    assert.equal(word, "");
  });
});
