import { tKey } from './tKey';
import type { Translator } from './translator';

/** Catalog keys of language names by ISO 639-1 code. */
const LANGUAGE_NAME_KEYS: Readonly<Record<string, string>> = {
  en: tKey('language.en'),
  es: tKey('language.es'),
};

/** The translated name of a language (PairPack.native / PairPack.target), or its code. */
export function languageName(t: Translator['t'], code: string): string {
  const key = LANGUAGE_NAME_KEYS[code];
  return key ? t(key) : code;
}
