import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { i18n } from "../i18n/index.ts";
import { DEFAULT_RULES, entryInput, newEntry, splitKeys, type EntryDraft } from "./cardEdit.ts";
import {
  bookStats,
  checkBook,
  checkLorebookFile,
  entryTags,
  hasUnsupported,
  hiddenRuleCount,
  LOREBOOK_LIMITS,
  lorebookSummary,
  matchesEntry,
  neverTriggers,
  parseWhole,
  reportLines,
  rulesOf,
  withRules,
} from "./lorebook.ts";

const entry = (patch: Partial<EntryDraft> = {}): EntryDraft => ({ ...newEntry(), ...patch });

describe("世界书", () => {
  void i18n.changeLanguage("zh");

  it("关键词：正则里的逗号不算分隔", () => {
    assert.deepEqual(splitKeys("老周，/x{1,3}/i, 渡口"), ["老周", "/x{1,3}/i", "渡口"]);
    assert.deepEqual(splitKeys("/a,b/"), ["/a,b/"]);
    // 以 / 开头但后面没有收尾的，照常分开
    assert.deepEqual(splitKeys("/help，abc"), ["/help", "abc"]);
    assert.deepEqual(splitKeys("甲\n乙、乙"), ["甲", "乙"]);
    const draft = entry({ keys: "/(周叔|老周),?/i，渡口" });
    assert.deepEqual(entryInput(draft).keys, ["/(周叔|老周),?/i", "渡口"]);
  });

  it("更多设置：全是默认值时存成 null，不给改的设置原样保留", () => {
    const changed = withRules(entry(), { probability: 30, groups: ["天气"] });
    assert.equal(changed.rules?.probability, 30);
    assert.deepEqual(rulesOf(changed).groups, ["天气"]);
    assert.equal(withRules(changed, { probability: 100, groups: [] }).rules, null);
    const imported = entry({ rules: { ...DEFAULT_RULES, scan_depth: 5, triggers: ["normal"], sticky: 2 } });
    assert.equal(hiddenRuleCount(imported), 2);
    const edited = withRules(imported, { sticky: 0 });
    assert.equal(edited.rules?.scan_depth, 5);
    assert.equal(hiddenRuleCount(entry()), 0);
  });

  it("数字输入", () => {
    assert.equal(parseWhole(" ", 0, 100), null);
    assert.equal(parseWhole("30", 0, 100), 30);
    assert.equal(parseWhole("101", 0, 100), undefined);
    assert.equal(parseWhole("3.5", 0, 100), undefined);
    assert.equal(parseWhole("-5", -10, 10), -5);
  });

  it("永远不会被带上的条目和小标", () => {
    assert.equal(neverTriggers(entry({ content: "有内容" })), true);
    assert.equal(neverTriggers(entry({ content: "有内容", keys: "门" })), false);
    assert.equal(neverTriggers(entry({ content: "有内容", constant: true })), false);
    assert.equal(neverTriggers(entry({ content: " ", keys: "门" })), true);
    const tagged = withRules(entry({ keys: "/门|窗/" }), { groups: ["天气"], probability: 40, sticky: 2 });
    assert.deepEqual(entryTags(tagged), ["分组：天气", "40%", "连着 2 回合", "正则"]);
  });

  it("搜索条目", () => {
    const e = entry({ name: "青石渡", keys: "渡口，Ferry" });
    assert.equal(matchesEntry(e, "ferry"), true);
    assert.equal(matchesEntry(e, "青石"), true);
    assert.equal(matchesEntry(e, "码头"), false);
    assert.equal(matchesEntry(e, " "), true);
  });

  it("检查：超过上限是 error，用不到是 warning", () => {
    const issues = checkBook([
      entry({ content: "有", keys: "长".repeat(301) }),
      entry({ content: "孤零零" }),
      entry({ content: "字".repeat(60_001), keys: "门" }),
      entry({ content: "停用的", enabled: false }),
    ]);
    assert.deepEqual(
      issues.map((i) => `${i.field}:${i.code}:${i.level}`),
      ["book.0.keys:key_too_long:error", "book.1.keys:entry_unreachable:warning", "book.2.content:field_too_long:error"],
    );
    const many = Array.from({ length: LOREBOOK_LIMITS.entries + 1 }, () => entry({ content: "x", keys: "k" }));
    assert.equal(checkBook(many)[0]?.code, "too_many_entries");
  });

  it("统计、导入报告、剧本里的一行", () => {
    assert.deepEqual(
      bookStats([
        { constant: true, enabled: true },
        { constant: false, enabled: false },
      ]),
      { entries: 2, constant: 1, disabled: 1 },
    );
    const report = {
      entries: 10,
      constant: 1,
      disabled: 0,
      dropped_empty: 2,
      dropped_unreachable: 0,
      dropped_over_limit: 0,
      vectorized: 0,
      character_filter: 0,
      bad_regex: 1,
      other_macros: 0,
    };
    assert.deepEqual(reportLines(report), ["2 条没有正文，没有导进来", "1 条的正则关键词写得不对：那个关键词不会命中"]);
    assert.equal(hasUnsupported(report), true);
    assert.equal(hasUnsupported({ ...report, bad_regex: 0 }), false);
    assert.deepEqual(reportLines(null), []);
    assert.equal(lorebookSummary([]), "没有挂世界书");
    assert.equal(lorebookSummary(["甲", "乙"]), "甲、乙");
    assert.equal(lorebookSummary(["甲", "乙", "丙"]), "甲、乙 等 3 本");
  });

  it("导入前看文件", () => {
    assert.equal(checkLorebookFile({ name: "书.JSON", size: 100 }), null);
    assert.match(checkLorebookFile({ name: "卡.png", size: 100 })?.title ?? "", /不是 JSON/);
    assert.match(checkLorebookFile({ name: "大.json", size: 9 * 1024 * 1024 })?.title ?? "", /8 MB/);
  });
});
