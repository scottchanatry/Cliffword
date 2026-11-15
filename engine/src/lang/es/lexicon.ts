/**
 * Spanish lexicon: lemmas in approximate frequency order (most frequent first, function
 * words included), with part of speech and, for nouns, gender.
 *
 * The data is stored compactly as whitespace-separated "lemma/code" items in
 * lexiconData*.ts and parsed once into rows [lemma, pos, gender?]. Codes:
 *   nm nf nc  noun masculine / feminine / common (both genders: amigo~amiga, estudiante)
 *   v verb, x auxiliary, a adjective, r adverb, d determiner, p pronoun,
 *   s adposition, c conjunction, i interjection, u numeral.
 * A lemma with several parts of speech lists them with "|" ("que/c|p"); its frequency
 * rank is its position among distinct lemmas.
 */
import type { Pos } from '../types';
import { LEXICON_DATA_1 } from './lexiconData1';
import { LEXICON_DATA_2 } from './lexiconData2';
import { LEXICON_DATA_3 } from './lexiconData3';
import { LEXICON_DATA_4 } from './lexiconData4';
import { LEXICON_DATA_5 } from './lexiconData5';

/** Noun gender in the lexicon: m, f, or c (common: the noun takes either gender). */
export type LexGender = 'm' | 'f' | 'c';
/** A lexicon row: [lemma, pos, gender?]. Nouns always carry a gender. */
export type LexRow = readonly [lemma: string, pos: Pos, gender?: LexGender];

const POS_CODES: Readonly<Record<string, Pos>> = {
  n: 'NOUN', v: 'VERB', x: 'AUX', a: 'ADJ', r: 'ADV', d: 'DET', p: 'PRON',
  s: 'ADP', c: 'CONJ', i: 'INTJ', u: 'NUM', o: 'PROPN',
};

/**
 * Parse compact lexicon data into rows.
 *
 * Method: split on whitespace; each item is "lemma/codes" where codes are separated by
 * "|"; a noun code is "n" followed by its gender letter. Throws on malformed items so a
 * typo in the data fails loudly in tests.
 */
export function parseLexicon(data: string): LexRow[] {
  const rows: LexRow[] = [];
  for (const item of data.split(/\s+/)) {
    if (!item) continue;
    const slash = item.lastIndexOf('/');
    if (slash <= 0) throw new Error(`lexicon: malformed item "${item}"`);
    const lemma = item.slice(0, slash).normalize('NFC');
    for (const code of item.slice(slash + 1).split('|')) {
      const pos = POS_CODES[code[0] ?? ''];
      if (!pos) throw new Error(`lexicon: unknown code "${code}" in "${item}"`);
      if (pos === 'NOUN') {
        const g = code[1];
        if (g !== 'm' && g !== 'f' && g !== 'c') throw new Error(`lexicon: noun without gender "${item}"`);
        rows.push([lemma, pos, g]);
      } else {
        if (code.length !== 1) throw new Error(`lexicon: bad code "${code}" in "${item}"`);
        rows.push([lemma, pos]);
      }
    }
  }
  return rows;
}

/** All lexicon rows in frequency order. */
export const LEXICON: readonly LexRow[] = parseLexicon(
  [LEXICON_DATA_1, LEXICON_DATA_2, LEXICON_DATA_3, LEXICON_DATA_4, LEXICON_DATA_5].join('\n'),
);

const RANKS = new Map<string, number>();
const ROWS_BY_LEMMA = new Map<string, LexRow[]>();
const LEMMAS: string[] = [];
for (const row of LEXICON) {
  const lemma = row[0];
  if (!RANKS.has(lemma)) {
    LEMMAS.push(lemma);
    RANKS.set(lemma, LEMMAS.length);
  }
  const list = ROWS_BY_LEMMA.get(lemma);
  if (list) list.push(row);
  else ROWS_BY_LEMMA.set(lemma, [row]);
}

/** Distinct lemmas in frequency order. */
export const LEMMAS_BY_FREQUENCY: readonly string[] = LEMMAS;

/** 1-based frequency rank of a lemma (1 = most frequent), or undefined if not listed. */
export function frequencyRank(lemma: string): number | undefined {
  return RANKS.get(lemma);
}

/** Lexicon rows of a lemma (one per part of speech), in data order; [] if unknown. */
export function lexiconRows(lemma: string): readonly LexRow[] {
  return ROWS_BY_LEMMA.get(lemma) ?? [];
}
