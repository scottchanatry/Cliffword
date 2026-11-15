/**
 * Helpers shared by the Spanish slang register packs: region codes, the entry builder,
 * and the normalization used for slang lookups.
 *
 * The normalization here mirrors the Spanish pack's normalize() (lowercase, NFC,
 * typographic apostrophes mapped to "'", edge punctuation trimmed, apostrophes of
 * clipped forms kept) but is implemented locally so this data module depends only on
 * the language-pack contract.
 */
import type { Formality, Pos, SlangEntry } from '../../types';

/** Puerto Rico. */
export const PR = 'PR';
/** Dominican Republic. */
export const DO = 'DO';
/** Cuba. */
export const CU = 'CU';
/** Colombia. */
export const CO = 'CO';
/** Shared across the Spanish-speaking Caribbean (clipped forms and common phrases). */
export const CARIB = 'CARIB';

/** Every region code a SlangEntry may carry. */
export const REGION_CODES: readonly string[] = [PR, DO, CU, CO, CARIB];

/**
 * Regions where CARIB entries apply. Colombia is included for its Caribbean coast and
 * because its urban music uses the same clipped forms (pa', to', na').
 */
export const CARIB_MEMBERS: readonly string[] = [PR, DO, CU, CO];

const APOSTROPHE_RE = /[’‘ʼ`´]/g;
const KEEP_RE = /[\p{L}\p{M}\p{N}']/u;

/**
 * Normalize a word or phrase for slang lookups.
 *
 * Method: NFC-compose, map typographic apostrophes to "'", lowercase, collapse inner
 * whitespace, then trim leading and trailing characters that are not letters, digits,
 * combining marks or apostrophes ("¿'Tá?" -> "'tá", "¡Wepa!" -> "wepa"). A word wrapped
 * in a pair of apostrophes used as quote marks is unwrapped ("'hola'" -> "hola"), while a
 * single edge apostrophe is kept because it marks a clipped form ("pa'", "'toy").
 */
export function slangNorm(s: string): string {
  const t = s.normalize('NFC').replace(APOSTROPHE_RE, "'").toLowerCase().replace(/\s+/g, ' ');
  let start = 0;
  let end = t.length;
  while (start < end && !KEEP_RE.test(t[start] as string)) start++;
  while (end > start && !KEEP_RE.test(t[end - 1] as string)) end--;
  let core = t.slice(start, end).trim();
  if (!/[\p{L}\p{N}]/u.test(core)) return '';
  if (core.length >= 3 && core.startsWith("'") && core.endsWith("'") && !core.slice(1, -1).includes("'")) {
    core = core.slice(1, -1);
  }
  return core;
}

/**
 * Accent- and apostrophe-insensitive key, used as a fallback when lyrics or speech
 * recognition drop the marks ("ta" for "'tá", "pa" for "pa'", "na" for "ná").
 *
 * Method: slangNorm, then decompose and drop combining marks except the tilde on n
 * (so ñ stays distinct from n), then remove apostrophes.
 */
export function looseSlangKey(s: string): string {
  const d = slangNorm(s).normalize('NFD');
  let out = '';
  for (const ch of d) {
    if (/\p{M}/u.test(ch)) {
      if (ch === '̃' && out.endsWith('n')) out += ch;
      continue;
    }
    if (ch === "'") continue;
    out += ch;
  }
  return out.normalize('NFC');
}

export interface EntryOptions {
  /** Defaults to the pack's region. */
  regions?: readonly string[];
  /** Defaults to "street". */
  formality?: Formality;
  /** Defaults to true for vulgar formality, false otherwise. */
  explicit?: boolean;
  /** Defaults to "word". */
  kind?: SlangEntry['kind'];
  /**
   * Defaults to the normalized form: a slang lexeme is its own lemma. A slang sense of a
   * word that is also a standard lemma (guapo "angry"), or of a lemma another pack
   * defines with another meaning (fajarse), takes the region as a suffix ("guapo@DO"),
   * so it has its own learner key and gloss.
   */
  lemma?: string;
  /**
   * Part of speech, when the neutral equivalent cannot supply it (it is outside the
   * standard lexicon, or another part of speech comes first). Omitted otherwise.
   */
  pos?: Pos;
  /**
   * The form (every word of a phrase) is also standard Spanish (guapo, dale, "de una"):
   * neutral-register corrections do not protect it. Checked against the analyzer by the
   * register tests.
   */
  alsoStandard?: boolean;
}

/**
 * Build a SlangEntry.
 *
 * Method: norm and (by default) lemma are slangNorm(form), so they always agree with the
 * surface form; vulgar entries are explicit unless stated otherwise; regions default to
 * the given pack region.
 */
export function slang(
  packRegion: string,
  form: string,
  neutral: string,
  en: string,
  opts: EntryOptions = {},
): SlangEntry {
  const norm = slangNorm(form);
  const formality = opts.formality ?? 'street';
  const entry: SlangEntry = {
    form,
    norm,
    neutral,
    lemma: opts.lemma ?? norm,
    gloss: { en },
    regions: [...(opts.regions ?? [packRegion])],
    formality,
    explicit: opts.explicit ?? formality === 'vulgar',
    kind: opts.kind ?? 'word',
  };
  if (opts.pos) entry.pos = opts.pos;
  if (opts.alsoStandard) entry.alsoStandard = true;
  return entry;
}

/**
 * Builders bound to one pack region: word (street by default), casual, clipped (casual),
 * phrase (casual) and vulgar (explicit). Each accepts EntryOptions overrides.
 */
export function builders(packRegion: string) {
  const make = (form: string, neutral: string, en: string, base: EntryOptions, opts: EntryOptions) =>
    slang(packRegion, form, neutral, en, { ...base, ...opts });
  return {
    word: (form: string, neutral: string, en: string, opts: EntryOptions = {}) => make(form, neutral, en, {}, opts),
    casual: (form: string, neutral: string, en: string, opts: EntryOptions = {}) =>
      make(form, neutral, en, { formality: 'casual' }, opts),
    clipped: (form: string, neutral: string, en: string, opts: EntryOptions = {}) =>
      make(form, neutral, en, { formality: 'casual', kind: 'clipped' }, opts),
    phrase: (form: string, neutral: string, en: string, opts: EntryOptions = {}) =>
      make(form, neutral, en, { formality: 'casual', kind: 'phrase' }, opts),
    vulgar: (form: string, neutral: string, en: string, opts: EntryOptions = {}) =>
      make(form, neutral, en, { formality: 'vulgar', explicit: true }, opts),
  };
}
