/** CLDR plural categories. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

const rulesCache = new Map<string, Intl.PluralRules | null>();

function rulesFor(locale: string): Intl.PluralRules | null {
  if (!rulesCache.has(locale)) {
    let rules: Intl.PluralRules | null = null;
    try {
      rules = typeof Intl !== 'undefined' && Intl.PluralRules ? new Intl.PluralRules(locale) : null;
    } catch {
      rules = null;
    }
    rulesCache.set(locale, rules);
  }
  return rulesCache.get(locale) ?? null;
}

/**
 * The plural category of count in locale. Uses Intl.PluralRules where the JavaScript
 * engine has it, otherwise the English rule (1 is "one", everything else "other").
 */
export function pluralCategory(locale: string, count: number): PluralCategory {
  const rules = rulesFor(locale);
  if (rules) return rules.select(count) as PluralCategory;
  return count === 1 ? 'one' : 'other';
}
