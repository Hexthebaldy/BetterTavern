/**
 * i18next 用 Intl.PluralRules 选复数形式。运行环境没有它时（部分 Hermes 版本），i18next 会退回
 * “1 是单数”的规则，中文、日文就会去找不存在的 key_one。这里补一个最小实现：中文、日文没有单复数，
 * 其他语言按英文的规则（1 是单数）。环境自带时不动。
 */

type Category = "one" | "other";

class MinimalPluralRules {
  private readonly language: "zh" | "ja" | "en";

  constructor(locales?: string | readonly string[]) {
    const tag = String((Array.isArray(locales) ? locales[0] : locales) ?? "en").toLowerCase();
    this.language = tag.startsWith("zh") ? "zh" : tag.startsWith("ja") ? "ja" : "en";
  }

  select(count: number): Category {
    return this.language === "en" && count === 1 ? "one" : "other";
  }

  resolvedOptions(): { locale: string; pluralCategories: Category[] } {
    return this.language === "en"
      ? { locale: "en", pluralCategories: ["one", "other"] }
      : { locale: this.language, pluralCategories: ["other"] };
  }
}

export function ensurePluralRules(): void {
  if (typeof Intl === "undefined" || typeof Intl.PluralRules === "function") return;
  Object.defineProperty(Intl, "PluralRules", {
    value: MinimalPluralRules,
    configurable: true,
    writable: true,
  });
}
