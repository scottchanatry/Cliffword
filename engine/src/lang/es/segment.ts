/**
 * Spanish segmenter: splits text into word, number, punctuation and space segments that
 * concatenate back to the input exactly.
 *
 * Apostrophes are the hard part. Street Spanish clips words and marks the gap with an
 * apostrophe ('tá, pa', to', na', pa'lante), but the same character is also used as a
 * single quotation mark. Inner apostrophes (pa'lante, pa'l) always stay in the word.
 * A trailing apostrophe stays in the word unless it closes a single quote opened before
 * the word. A leading apostrophe stays only for known clipped forms, which the caller
 * can extend (for example from register packs).
 *
 * Some clipped forms are also standard words (tan, té, mano, ora; lo, eso, mucho), so
 * for them an apostrophe that may be a quote mark is read as one: a leading apostrophe
 * opens a quote when a closing apostrophe follows later in the text ("Dijo: 'tan
 * bonito'."), and inside an open quote a trailing apostrophe closes it ("dijo 'eso' y").
 */
import type { Segment } from '../types';
import { isStandardForm } from './analyze';
import { canonicalApostrophes, isApostrophe, normalize } from './normalize';

/**
 * Words (lowercase, accents kept, without the apostrophe) that are written with a
 * leading apostrophe in clipped street forms: 'tá = está, 'toy = estoy, 'ombe = hombre.
 */
export const DEFAULT_LEADING_CLIPS: readonly string[] = [
  'tá', 'ta', 'tás', 'tas', 'toy', 'tamos', 'tamo', 'tán', 'tan', 'taba', 'tabas', 'tábamos',
  'tábamo', 'taban', 'tar', 'té', 'tés', 'tén', 'tuve', 'tuvo', 'tuvimos', 'tuvieron', 'tuviera',
  'ombe', 'mano', 'mana', 'manito', 'manita', 'ñor', 'ña', 'pérate', 'perate', 'ora', 'onde',
];

/**
 * Words written with a trailing apostrophe that keep it even inside single quotes:
 * pa' = para, na' = nada, to' = todo, ma' = más, usté' = usted, verdá' = verdad.
 */
export const DEFAULT_TRAILING_CLIPS: readonly string[] = [
  'pa', 'na', 'to', 'ma', 'pue', 'usté', 'verdá', 'ná', 'tó', 'mai', 'pai', 'lo', 'mucho', 'eso',
];

export interface SegmenterOptions {
  /** Extra leading-apostrophe clipped forms, with or without the apostrophe. */
  leadingClips?: Iterable<string>;
  /** Extra trailing-apostrophe clipped forms, with or without the apostrophe. */
  trailingClips?: Iterable<string>;
  /**
   * True for a clipped form (lowercase, without its apostrophe) that is also a standard
   * word, so a quote-mark reading of its apostrophe wins when the text allows one.
   * Defaults to an exact lookup in the standard lexicon (isStandardForm).
   */
  isStandardWord?: (word: string) => boolean;
}

const SPACE_RE = /\s+/uy;
const WORD_CORE_RE = /[\p{L}\p{M}]+(?:['’‘ʼ][\p{L}\p{M}]+)*/uy;
/** Digits with inner "." or "," groups, and an ordinal mark (2º, 1ª). */
const NUMBER_RE = /\d+(?:[.,]\d+)*[ºª]?/uy;
const EMOJI_RE =
  /(?:\p{Regional_Indicator}\p{Regional_Indicator}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)[\u{E0020}-\u{E007F}]*/uy;
const TRAILING_MARKS_RE = /[\p{M}️‍]*/uy;
const LETTER_OR_DIGIT_RE = /[\p{L}\p{M}\p{N}]/u;
const LETTER_RE = /[\p{L}]/u;

function clipKey(s: string): string {
  return canonicalApostrophes(s.normalize('NFC')).toLowerCase().replace(/^'+|'+$/g, '');
}

function matchAt(re: RegExp, text: string, i: number): string | null {
  re.lastIndex = i;
  const m = re.exec(text);
  return m ? m[0] : null;
}

/**
 * Build a segmenter with the default clipped forms plus any extras.
 *
 * Method: a left-to-right scan with sticky regular expressions. At each position it
 * tries, in order: whitespace run (space); a leading apostrophe that belongs to a known
 * clipped form; a word core (letters and marks, with inner apostrophes); a number with
 * inner "." or "," groups (3,5 and 1.000); an emoji cluster; a run of periods, "!" or
 * "?"; any other single character (with trailing combining marks). After a word core a
 * trailing apostrophe is attached unless it closes an open single quote. Missing spaces
 * after punctuation need no special case because punctuation never joins a word.
 */
export function createSegmenter(opts: SegmenterOptions = {}): (text: string) => Segment[] {
  const leading = new Set(DEFAULT_LEADING_CLIPS.map(clipKey));
  const trailing = new Set(DEFAULT_TRAILING_CLIPS.map(clipKey));
  for (const s of opts.leadingClips ?? []) leading.add(clipKey(s));
  for (const s of opts.trailingClips ?? []) trailing.add(clipKey(s));
  const standard = opts.isStandardWord ?? isStandardForm;
  const ambiguous = new Map<string, boolean>();
  /** A clipped form that is also a standard word (cached). */
  const isAmbiguous = (key: string): boolean => {
    let v = ambiguous.get(key);
    if (v === undefined) {
      v = standard(key);
      ambiguous.set(key, v);
    }
    return v;
  };
  /**
   * True when an apostrophe after `from` could close a quote: one that ends a word (a
   * letter before it, no letter or digit after it) which is not an unambiguous trailing
   * clipped form (pa', to').
   */
  const closingQuoteAfter = (text: string, from: number): boolean => {
    for (let j = from; j < text.length; j++) {
      if (!isApostrophe(text[j]) || !LETTER_RE.test(text[j - 1] ?? '') || LETTER_OR_DIGIT_RE.test(text[j + 1] ?? ' ')) continue;
      let k = j;
      while (k > 0 && /[\p{L}\p{M}]/u.test(text[k - 1] as string)) k--;
      const key = clipKey(text.slice(k, j));
      if (trailing.has(key) && !isAmbiguous(key)) continue;
      return true;
    }
    return false;
  };

  return function segment(text: string): Segment[] {
    const out: Segment[] = [];
    let i = 0;
    let openQuote = false;
    const push = (start: number, end: number, kind: Segment['kind']) => {
      const t = text.slice(start, end);
      const norm = kind === 'space' ? '' : kind === 'word' ? normalize(t) : canonicalApostrophes(t.normalize('NFC'));
      out.push({ text: t, norm, start, end, kind });
    };

    while (i < text.length) {
      const sp = matchAt(SPACE_RE, text, i);
      if (sp) {
        push(i, i + sp.length, 'space');
        i += sp.length;
        continue;
      }
      const ch = text[i] as string;
      const prev = text[i - 1];
      // Apostrophe before a word: clipped form or opening quote.
      if (isApostrophe(ch) && (prev === undefined || !LETTER_OR_DIGIT_RE.test(prev))) {
        const core = matchAt(WORD_CORE_RE, text, i + 1);
        if (core) {
          const key = clipKey(core);
          if (leading.has(key) && !(isAmbiguous(key) && closingQuoteAfter(text, i + 1 + core.length))) {
            const end = i + 1 + core.length;
            push(i, end, 'word');
            i = end;
            continue;
          }
          push(i, i + 1, 'punct');
          openQuote = true;
          i += 1;
          continue;
        }
      }
      const core = matchAt(WORD_CORE_RE, text, i);
      if (core && LETTER_RE.test(core)) {
        let end = i + core.length;
        const next = text[end];
        if (isApostrophe(next) && !LETTER_OR_DIGIT_RE.test(text[end + 1] ?? ' ')) {
          const key = clipKey(core);
          if (!openQuote || (trailing.has(key) && !isAmbiguous(key))) end += 1;
        }
        push(i, end, 'word');
        i = end;
        continue;
      }
      const num = matchAt(EMOJI_RE, text, i);
      if (num && !/^\d+$/.test(num)) {
        push(i, i + num.length, 'punct');
        i += num.length;
        continue;
      }
      const n = matchAt(NUMBER_RE, text, i);
      if (n) {
        push(i, i + n.length, 'number');
        i += n.length;
        continue;
      }
      if (ch === '.' || ch === '!' || ch === '?') {
        let j = i;
        while (text[j] === ch) j++;
        push(i, j, 'punct');
        i = j;
        continue;
      }
      // Any other character: one code point plus trailing marks/selectors.
      const cp = String.fromCodePoint(text.codePointAt(i) as number);
      let end = i + cp.length;
      const marks = matchAt(TRAILING_MARKS_RE, text, end);
      if (marks) end += marks.length;
      if (isApostrophe(ch)) openQuote = !openQuote && LETTER_OR_DIGIT_RE.test(text[end] ?? '') ? true : false;
      push(i, end, 'punct');
      i = end;
    }
    return out;
  };
}

/** Segment Spanish text with the default clipped forms. See createSegmenter. */
export const segment: (text: string) => Segment[] = createSegmenter();
