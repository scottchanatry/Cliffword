/**
 * Estimated spoken length of a word, for sizing blank tiles before text-to-speech
 * timings exist (tiles are sized by duration: B1-Voice-Cliff). Once the TTS engine
 * reports word timings, use those instead.
 *
 * Method: syllables x msPerSyllable, divided by the speech rate. Syllables come from
 * options.syllables(word) when the pack supplies a syllable counter (the speaking module
 * never imports a language), else from a script-neutral fallback:
 * - count groups of consecutive vowel letters (options.vowels) in the accent-folded,
 *   lowercased word ("puesto" has 2: ue, o; "muy" has 1: uy);
 * - a word with letters but no vowel letter counts one syllable per letter: spelled-out
 *   abbreviations ("TV", "klk") and syllabic or logographic scripts, where one character
 *   is about one syllable or mora;
 * - a number counts numberSyllablesPerDigit per digit;
 * - at least minSyllables.
 * Vowel groups undercount hiatus ("día", "leer"); a pack syllable counter fixes that.
 */
import type { LanguagePack, Segment } from '../lang/types';
import { DEFAULT_ACCENT_MARKS } from '../scoring/text';
import { accentFolder, normOf } from './text';

/** Tunable numbers of duration estimates. */
export interface DurationOptions {
  /** Syllable counter of the language (e.g. the Spanish pack's syllableCount); the fallback when undefined. */
  syllables: ((word: string) => number) | undefined;
  /** Spoken length of one syllable at speech rate 1 (ms). */
  msPerSyllable: number;
  /** Vowel letters for the fallback, after accent folding and lowercasing. */
  vowels: string;
  /** Syllables per digit of a number ("25" is "veinticinco", four syllables for two digits). */
  numberSyllablesPerDigit: number;
  /** Every word lasts at least this many syllables. */
  minSyllables: number;
  /** Combining marks folded when the pack has no foldAccents. */
  marks: string;
}

/**
 * Defaults.
 * - msPerSyllable 150: cross-language studies of read speech put natural rates at
 *   roughly 5 to 8 syllables a second (Spanish near the top, about 7.8); 150 ms (6.7 a
 *   second) is mid-range, and a learner's TTS at rate 1 is rarely faster. Tiles only
 *   need the right proportions until real timings arrive.
 * - vowels "aeiouy": Latin vowel letters after folding (y counts as a vowel, so "muy",
 *   "hoy" and the word "y" have one group); other scripts fall back to letters.
 * - numberSyllablesPerDigit 2: Spanish numbers run 2 to 3 syllables per digit
 *   ("veinticinco" 4 for 2 digits, "mil novecientos noventa y ocho" 11 for 4).
 * - minSyllables 1: even "y" and "a" need a tile a finger can hit.
 */
export const DEFAULT_DURATION_OPTIONS: Readonly<DurationOptions> = {
  syllables: undefined,
  msPerSyllable: 150,
  vowels: 'aeiouy',
  numberSyllablesPerDigit: 2,
  minSyllables: 1,
  marks: DEFAULT_ACCENT_MARKS,
};

const LETTER_RE = /[\p{L}]/u;
const DIGIT_RE = /\p{N}/u;

/** Fallback syllable count of a word (see the module comment). */
export function fallbackSyllables(
  word: string,
  pack: Pick<LanguagePack, 'foldAccents'>,
  opts: Partial<DurationOptions> = {},
): number {
  const o: DurationOptions = { ...DEFAULT_DURATION_OPTIONS, ...opts };
  const folded = accentFolder(pack, o.marks)(word.normalize('NFC').toLowerCase());
  const vowels = new Set(Array.from(o.vowels));
  let groups = 0;
  let letters = 0;
  let digits = 0;
  let inGroup = false;
  for (const ch of folded) {
    if (DIGIT_RE.test(ch)) digits++;
    if (!LETTER_RE.test(ch)) {
      inGroup = false;
      continue;
    }
    letters++;
    if (vowels.has(ch)) {
      if (!inGroup) groups++;
      inGroup = true;
    } else {
      inGroup = false;
    }
  }
  if (groups > 0) return groups;
  if (letters > 0) return letters;
  return digits * o.numberSyllablesPerDigit;
}

/**
 * Estimated spoken length of `word` in ms at `speechRate` (1 = natural speed, as in
 * DifficultyParams.speechRate; 0.75 is slower, so longer). A non-positive or non-finite
 * rate counts as 1. See the module comment for the method.
 */
export function estimateDurationMs(
  word: string,
  pack: Pick<LanguagePack, 'foldAccents'>,
  speechRate: number,
  opts: Partial<DurationOptions> = {},
): number {
  const o: DurationOptions = { ...DEFAULT_DURATION_OPTIONS, ...opts };
  const counted = o.syllables ? o.syllables(word) : fallbackSyllables(word, pack, o);
  const syllables = Math.max(o.minSyllables, Number.isFinite(counted) ? counted : 0);
  const rate = Number.isFinite(speechRate) && speechRate > 0 ? speechRate : 1;
  return (syllables * o.msPerSyllable) / rate;
}

/** A word or number of a text with its estimated duration. */
export interface WordDuration {
  segment: Segment;
  /** Index among the word and number segments. */
  index: number;
  durationMs: number;
}

/**
 * Estimated durations of every word and number of a text, in order (segmented with the
 * pack, never split on spaces). Words are measured on their normalized form.
 */
export function estimateDurations(
  text: string,
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>,
  speechRate: number,
  opts: Partial<DurationOptions> = {},
): WordDuration[] {
  const out: WordDuration[] = [];
  for (const seg of pack.segment(text)) {
    if (seg.kind !== 'word' && seg.kind !== 'number') continue;
    out.push({ segment: seg, index: out.length, durationMs: estimateDurationMs(normOf(pack, seg), pack, speechRate, opts) });
  }
  return out;
}
