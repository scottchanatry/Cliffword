/**
 * Small, pure text helpers shared by story selection, prompting, cliff picking and gap
 * capture. Nothing here assumes that spaces separate words: everything that needs words
 * goes through LanguagePack.segment(); the raw-string helpers only look at punctuation.
 */
import type { Segment } from '../lang/types';

/** Characters that end a sentence (Latin and CJK). */
export const SENTENCE_END_CHARS = '.!?…。！？';

/** Characters that may close a sentence after its final punctuation (quotes, brackets). */
export const SENTENCE_CLOSERS = `"'”’»)]」』`;

/**
 * Abbreviations (normalized, without the dot) after which a period does not end a
 * sentence. Spanish defaults; pass another list for other languages.
 */
export const DEFAULT_ABBREVIATIONS: readonly string[] = [
  'sr', 'sra', 'srta', 'sres', 'sras', 'dr', 'dra', 'ud', 'uds', 'vd', 'vds',
  'prof', 'profa', 'av', 'avda', 'dña', 'núm', 'pág',
];

const CJK_END_RE = /[。！？]/u;
const ELLIPSIS_RE = /^(?:…|\.{2,})$/u;
const LETTER_RE = /\p{L}/u;

/** True for segments that carry a word or a number (what a listener hears as a word). */
export function isContent(seg: Segment): boolean {
  return seg.kind === 'word' || seg.kind === 'number';
}

/** Word and number segments, in order. */
export function contentSegments(segments: readonly Segment[]): Segment[] {
  return segments.filter(isContent);
}

/** Word segments only (the indexing used by WordScore and CliffPosition). */
export function wordSegments(segments: readonly Segment[]): Segment[] {
  return segments.filter((s) => s.kind === 'word');
}

/** True if the text contains at least one letter. */
export function hasLetter(text: string): boolean {
  return LETTER_RE.test(text);
}

/**
 * True when the first letter of `text` is uppercase. Leading apostrophes and punctuation
 * are skipped, so "'Tá" and "¿Qué" count as capitalized.
 */
export function isCapitalized(text: string): boolean {
  const m = /\p{L}/u.exec(text);
  if (!m) return false;
  const ch = m[0];
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

/** Uppercase the first letter of `text`, skipping leading punctuation ("'tá" -> "'Tá"). */
export function capitalizeFirst(text: string): string {
  const m = /\p{L}/u.exec(text);
  if (!m) return text;
  return text.slice(0, m.index) + m[0].toUpperCase() + text.slice(m.index + m[0].length);
}

/**
 * Fold text for loose matching: decompose, drop combining marks, lowercase.
 * "Oración" -> "oracion", "ÑANDÚ" -> "nandu".
 */
export function foldForMatch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** True for a punctuation segment that ends a sentence (". ? ! … 。"). */
export function isSentenceEndPunct(seg: Segment): boolean {
  if (seg.kind !== 'punct') return false;
  for (const ch of seg.text) if (SENTENCE_END_CHARS.includes(ch)) return true;
  return false;
}

/**
 * For each segment, whether it ends a sentence.
 *
 * Method: a sentence-final punctuation segment ends a sentence unless it is a single
 * period right after an abbreviation ("Sr." in "el Sr. García").
 */
export function sentenceEndFlags(
  segments: readonly Segment[],
  abbreviations: readonly string[] = DEFAULT_ABBREVIATIONS,
): boolean[] {
  const abbr = new Set(abbreviations);
  let lastContent: Segment | undefined;
  return segments.map((seg) => {
    if (isContent(seg)) {
      lastContent = seg;
      return false;
    }
    if (!isSentenceEndPunct(seg)) return false;
    const prevWasAbbrev = seg.text === '.' && lastContent !== undefined && abbr.has(lastContent.norm);
    lastContent = undefined;
    return !prevWasAbbrev;
  });
}

/**
 * For each segment, whether it is a word or number that starts a sentence: the first
 * content segment of the text, or the first one after a sentence end. Opening marks
 * (¿ ¡ quotes) between the end and the word do not matter.
 */
export function sentenceStartFlags(
  segments: readonly Segment[],
  abbreviations: readonly string[] = DEFAULT_ABBREVIATIONS,
): boolean[] {
  const ends = sentenceEndFlags(segments, abbreviations);
  let atStart = true;
  return segments.map((seg, i) => {
    if (ends[i]) {
      atStart = true;
      return false;
    }
    if (!isContent(seg)) return false;
    const start = atStart;
    atStart = false;
    return start;
  });
}

function previousWord(text: string, end: number): string {
  const m = /[\p{L}\p{M}]+$/u.exec(text.slice(0, end));
  return m ? m[0].toLowerCase() : '';
}

/**
 * Split raw text into sentences without a language pack.
 *
 * Method: scan for runs of sentence-final punctuation; the run plus any closing quotes
 * or brackets ends a sentence when it is followed by whitespace or the end of the text
 * (CJK full stops need no space). A lone period after an abbreviation does not end a
 * sentence, and an ellipsis only does when the next text starts like a sentence
 * (uppercase letter, ¿, ¡, a quote or a dash). Sentences are trimmed; empty pieces are
 * dropped. A final piece without end punctuation is kept.
 */
export function splitSentences(text: string, abbreviations: readonly string[] = DEFAULT_ABBREVIATIONS): string[] {
  const abbr = new Set(abbreviations);
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (!SENTENCE_END_CHARS.includes(ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && SENTENCE_END_CHARS.includes(text[j] as string)) j++;
    const run = text.slice(i, j);
    while (j < text.length && SENTENCE_CLOSERS.includes(text[j] as string)) j++;
    const atEnd = j >= text.length;
    let boundary = atEnd || /\s/u.test(text[j] as string) || CJK_END_RE.test(run);
    if (boundary && run === '.' && abbr.has(previousWord(text, i))) boundary = false;
    if (boundary && !atEnd && ELLIPSIS_RE.test(run)) {
      const rest = text.slice(j).trimStart();
      boundary = rest === '' || /^[\p{Lu}¿¡"“«'‘—–-]/u.test(rest);
    }
    if (boundary) {
      const piece = text.slice(start, j).trim();
      if (piece) out.push(piece);
      start = j;
    }
    i = j;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Clamp a probability to [0, 1]; NaN becomes 0. */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return x === Infinity ? 1 : 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Round a possibly fractional count to a whole number of at least `min`. */
export function wholeAtLeast(x: number, min = 1): number {
  return Number.isFinite(x) ? Math.max(min, Math.round(x)) : min;
}
