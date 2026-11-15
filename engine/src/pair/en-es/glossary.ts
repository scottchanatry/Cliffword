/**
 * English <-> Spanish glossary: short English glosses of Spanish lemmas (gloss) and
 * Spanish candidate lemmas for English words (toTarget), with the lookup helpers.
 */
import { EN_ES_DATA, EN_ES_PHRASE_DATA, EN_IRREGULAR } from './glossaryEnEs';
import { ES_EN_DATA } from './glossaryEsEn';

/**
 * Parse "key = value" lines. Blank lines are skipped; a line without " = ", an empty key
 * or value, or a repeated key throws, so a typo in the data fails loudly in tests.
 */
export function parseGlossLines(data: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of data.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(' = ');
    if (i <= 0) throw new Error(`glossary: malformed line "${line}"`);
    const key = line.slice(0, i).trim().normalize('NFC');
    const value = line.slice(i + 3).trim().normalize('NFC');
    if (!key || !value) throw new Error(`glossary: empty key or value in "${line}"`);
    if (out.has(key)) throw new Error(`glossary: duplicate key "${key}"`);
    out.set(key, value);
  }
  return out;
}

/** Spanish lemma -> short English gloss. */
export const ES_TO_EN: ReadonlyMap<string, string> = parseGlossLines(ES_EN_DATA);

/** English word -> Spanish candidate lemmas, best first. */
export const EN_TO_ES: ReadonlyMap<string, readonly string[]> = new Map(
  [...parseGlossLines(EN_ES_DATA)].map(([en, es]) => [
    en,
    es.split(',').map((s) => s.trim()).filter(Boolean),
  ]),
);

/** English multi-word expression (lowercase, single spaces) -> Spanish candidate lemmas, best first. */
export const EN_PHRASES_TO_ES: ReadonlyMap<string, readonly string[]> = new Map(
  [...parseGlossLines(EN_ES_PHRASE_DATA)].map(([en, es]) => [
    en,
    es.split(',').map((s) => s.trim()).filter(Boolean),
  ]),
);

/**
 * Normalize an English word for lookup: NFC, typographic apostrophes to "'", lowercase,
 * edge punctuation trimmed (in-word apostrophes kept: "don't"). "" if no letters.
 */
export function normalizeEnglish(word: string): string {
  const s = word.normalize('NFC').replace(/[’‘ʼ]/g, "'").toLowerCase().trim();
  const m = /^[^\p{L}\p{N}]*(.*?)[^\p{L}\p{N}]*$/u.exec(s);
  const core = m?.[1] ?? '';
  return /[\p{L}\p{N}]/u.test(core) ? core : '';
}

const VOWELS = 'aeiou';

/**
 * Candidate base forms of a regularly inflected English word, most likely first.
 *
 * Method: strip a possessive "'s", then try the usual suffix rules: -ies/-ied -> -y
 * (stories, tried), -es and -s (watches, makes), -ed and -ing with and without a final
 * "e" and with a doubled final consonant undone (walked, danced, stopped; walking,
 * dancing, running), -er/-est on adjectives (bigger, nicer, happiest), and -ly
 * (quickly -> quick). Candidates shorter than two letters are dropped. Irregular forms
 * (went, children) are handled separately by EN_IRREGULAR.
 */
export function englishBaseCandidates(word: string): string[] {
  const w = word.endsWith("'s") ? word.slice(0, -2) : word;
  const out: string[] = [];
  const add = (s: string) => {
    if (s.length >= 2 && s !== word && !out.includes(s)) out.push(s);
  };
  if (w !== word) add(w);
  const undouble = (stem: string) => {
    const a = stem[stem.length - 1];
    const b = stem[stem.length - 2];
    if (a && a === b && !VOWELS.includes(a)) add(stem.slice(0, -1));
  };
  if (w.endsWith('ies') || w.endsWith('ied')) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  if (w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    add(stem);
    add(`${stem}e`);
    undouble(stem);
  }
  if (w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    undouble(stem);
  }
  for (const suf of ['est', 'er']) {
    if (!w.endsWith(suf)) continue;
    const stem = w.slice(0, -suf.length);
    if (stem.endsWith('i')) add(`${stem.slice(0, -1)}y`);
    add(stem);
    add(`${stem}e`);
    undouble(stem);
  }
  if (w.endsWith('ly')) {
    const stem = w.slice(0, -2);
    if (stem.endsWith('i')) add(`${stem.slice(0, -1)}y`);
    add(stem);
  }
  return out;
}

/**
 * Spanish candidate lemmas for an English word or phrase, best first; [] if unknown.
 *
 * Method: a text with spaces is a phrase: its words are normalized and joined with
 * single spaces and looked up in EN_PHRASES_TO_ES ("Hardware store" -> ferretería);
 * an unknown phrase gives []. For a single word: take the entry for the word itself,
 * then the entry for its irregular base form (went -> go, left -> leave), merged in that
 * order. Only if neither exists, try the regular base candidates (walked -> walk,
 * stories -> story) and merge the entries of every candidate found. Duplicates are
 * removed.
 */
export function toTargetEs(word: string): string[] {
  if (/\s/u.test(word.trim())) {
    const phrase = word.trim().split(/\s+/u).map(normalizeEnglish).filter(Boolean).join(' ');
    return [...(EN_PHRASES_TO_ES.get(phrase) ?? [])];
  }
  const w = normalizeEnglish(word);
  if (!w) return [];
  const out: string[] = [];
  const take = (key: string | undefined) => {
    if (!key) return;
    for (const t of EN_TO_ES.get(key) ?? []) if (!out.includes(t)) out.push(t);
  };
  take(w);
  take(EN_IRREGULAR[w]);
  if (out.length) return out;
  for (const base of englishBaseCandidates(w)) {
    take(base);
    take(EN_IRREGULAR[base]);
  }
  return out;
}

/**
 * Short English gloss of a Spanish lemma, or undefined.
 *
 * Method: exact lookup, then the NFC-lowercased, trimmed lemma (so "Casa" and a
 * decomposed "está" still match). No guessing from similar spellings: a missing gloss
 * is better than a wrong one.
 */
export function glossEs(lemma: string): string | undefined {
  return ES_TO_EN.get(lemma) ?? ES_TO_EN.get(lemma.normalize('NFC').toLowerCase().trim());
}
