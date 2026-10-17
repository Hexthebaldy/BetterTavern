/**
 * i18next 用 Intl.PluralRules 选复数形式。运行环境没有它时（部分 Hermes 版本），i18next 会退回
 * “1 是单数”的规则，中文就会去找不存在的 key_one。这里补一个只认识中文和英文的最小实现；环境自带时不动。
 */

type Category = "one" | "other";

class MinimalPluralRules {
  private readonly chinese: boolean;

  constructor(locales?: string | readonly string[]) {
    const tag = (Array.isArray(locales) ? locales[0] : locales) ?? "en";
    this.chinese = String(tag).toLowerCase().startsWith("zh");
  }

  select(count: number): Category {
    return !this.chinese && count === 1 ? "one" : "other";
  }

  resolvedOptions(): { locale: string; pluralCategories: Category[] } {
    return this.chinese
      ? { locale: "zh", pluralCategories: ["other"] }
      : { locale: "en", pluralCategories: ["one", "other"] };
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
