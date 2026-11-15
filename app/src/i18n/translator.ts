/**
 * The translation function behind useI18n().t.
 *
 * Lookup order for a key:
 * 1. pair.ui (the engine's pair pack interface strings, e.g. en-es), so a pair can reword
 *    any string;
 * 2. the app catalog for the learner's native language (src/i18n/catalog);
 * 3. the fallback (English) catalog;
 * 4. the key itself, with a console warning in development.
 */
import { catalogs as defaultCatalogs, FALLBACK_LANGUAGE, type Catalog, type CatalogKey } from './catalog';
import { interpolate, type TranslationVars } from './interpolate';
import { pluralCategory } from './plural';

/** A catalog key (autocompleted) or any pair.ui key. */
export type TranslationKey = CatalogKey | (string & {});

export interface TranslatorOptions {
  /** Interface strings of the active pair pack (PairPack.ui). */
  ui?: Readonly<Record<string, string>>;
  /** The learner's native language (PairPack.native), e.g. "en". */
  native?: string;
  /** App catalogs by language; defaults to the bundled ones. */
  catalogs?: Readonly<Record<string, Catalog>>;
  /** Called once per missing key; defaults to console.warn in development, nothing in production. */
  onMissing?: (key: string) => void;
}

export interface Translator {
  readonly native: string;
  /** The string for key with {name} placeholders filled. */
  t(key: TranslationKey, vars?: TranslationVars): string;
  /** key.<category> for count (CLDR category, falling back to key.other), with {count} filled. */
  plural(key: string, count: number, vars?: TranslationVars): string;
  /** Whether any source has key. */
  has(key: string): boolean;
}

function defaultOnMissing(): (key: string) => void {
  const warned = new Set<string>();
  return (key) => {
    if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[i18n] Missing string for key "${key}"`);
  };
}

export function createTranslator(opts: TranslatorOptions = {}): Translator {
  const native = opts.native ?? FALLBACK_LANGUAGE;
  const all = opts.catalogs ?? defaultCatalogs;
  const sources: Catalog[] = [opts.ui ?? {}, all[native] ?? {}, all[FALLBACK_LANGUAGE] ?? {}];
  const onMissing = opts.onMissing ?? defaultOnMissing();

  const lookup = (key: string): string | undefined => {
    for (const source of sources) {
      const value = source[key];
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const t = (key: string, vars?: TranslationVars): string => {
    const template = lookup(key);
    if (template === undefined) {
      onMissing(key);
      return key;
    }
    return interpolate(template, vars);
  };

  const plural = (key: string, count: number, vars?: TranslationVars): string => {
    const category = pluralCategory(native, count);
    const exact = `${key}.${category}`;
    const chosen = lookup(exact) !== undefined ? exact : `${key}.other`;
    return t(chosen, { count, ...vars });
  };

  return { native, t, plural, has: (key) => lookup(key) !== undefined };
}
