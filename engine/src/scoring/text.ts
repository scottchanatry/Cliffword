/**
 * Small, language-neutral text helpers shared by the scoring module.
 *
 * Everything here works on Unicode character classes only (letters, marks, digits,
 * whitespace). Word boundaries in real text always come from LanguagePack.segment();
 * these helpers only classify single characters and model tokens.
 */
import type { LanguagePack, Segment } from '../lang/types';

const LETTER_RE = /^[\p{L}\p{M}]$/u;
const DIGIT_RE = /^\p{N}$/u;
const SPACE_RE = /^\s$/u;
const UPPER_RE = /^\p{Lu}$/u;
const APOSTROPHES = new Set(["'", '’', 'ʼ']);
/** Punctuation after which the next word is written without a space. */
const OPENING_PUNCT = new Set(['¿', '¡', '«', '“', '‘', '„', '‚', '‹', '(', '[', '{']);
/** Sentence-final punctuation. */
const SENTENCE_END = new Set(['.', '?', '!', '…', '。', '？', '！']);
/** Closing marks that may follow sentence-final punctuation. */
const CLOSING_PUNCT = new Set(['»', '”', '’', '"', "'", ')', ']', '}', '›']);
/**
 * A character of a script written without spaces between words (Han, Hiragana, Katakana,
 * Thai, Lao, Khmer, Myanmar) or CJK punctuation and full-width forms: a word or sentence
 * written after it takes no space. Script-level data, not language data: it holds for
 * every language written in these scripts.
 */
const NO_SPACE_SCRIPT_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\u3000-\u303F\u30FC\uFF00-\uFFEF]$/u;

/**
 * Combining marks treated as "accents" by default when comparing answers that may be
 * missing them: grave, acute, circumflex and diaeresis. The tilde (U+0303) is not in
 * the default set because in Spanish ñ is a different letter, not an accented n; a
 * Portuguese pack would add it. Japanese dakuten (U+3099) are never in this set.
 */
export const DEFAULT_ACCENT_MARKS = '̀́̂̈';

/** First code point of `s` as a string, or '' for an empty string. */
export function firstChar(s: string): string {
  const cp = s.codePointAt(0);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/** Last code point of `s` as a string, or '' for an empty string. Surrogate-pair safe. */
export function lastChar(s: string): string {
  if (!s) return '';
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xdc00 && last <= 0xdfff && s.length >= 2) {
    const prev = s.charCodeAt(s.length - 2);
    if (prev >= 0xd800 && prev <= 0xdbff) return s.slice(-2);
  }
  return s.slice(-1);
}

/** True for a single letter or combining mark (any script). */
export function isLetter(ch: string): boolean {
  return LETTER_RE.test(ch);
}

/** True for a single digit character (any script). */
export function isDigit(ch: string): boolean {
  return DIGIT_RE.test(ch);
}

/** True for a single whitespace character. */
export function isSpace(ch: string): boolean {
  return SPACE_RE.test(ch);
}

/** True for the apostrophes used inside or at the edge of words ('tá, pa', ma’am). */
export function isApostrophe(ch: string): boolean {
  return APOSTROPHES.has(ch);
}

/** True if `s` is non-empty and contains only whitespace. */
export function isAllSpace(s: string): boolean {
  return s.length > 0 && s.trim().length === 0;
}

/**
 * True if `text` ends inside a word: its last character is a letter or mark, or it is
 * an apostrophe directly after a letter (a word-final apostrophe as in "pa'").
 * Used to decide whether a following letter piece continues that word.
 */
export function endsInsideWord(text: string): boolean {
  const last = lastChar(text);
  if (!last) return false;
  if (isLetter(last)) return true;
  if (isApostrophe(last)) {
    const before = lastChar(text.slice(0, text.length - last.length));
    return before !== '' && isLetter(before);
  }
  return false;
}

/**
 * True if a word written right after `context` needs a leading space under the model
 * spacing convention ("a token that begins a new word carries its leading space").
 *
 * No space is needed when the context is empty, already ends in whitespace, ends in
 * opening punctuation (¿ ¡ « “ ( and so on), or ends in a character of a script written
 * without spaces (Japanese, Chinese, Thai; CJK punctuation such as 。 and full-width
 * forms), where words and sentences follow each other directly. A straight double quote counts as opening
 * when the context holds an odd number of them. An apostrophe counts as opening unless
 * it directly follows a letter (then it is word-final, as in "pa'"). Anything else (a
 * word, a number, a comma, a full stop) needs a space.
 */
export function needsLeadingSpace(context: string): boolean {
  const last = lastChar(context);
  if (!last || isSpace(last)) return false;
  if (OPENING_PUNCT.has(last)) return false;
  if (NO_SPACE_SCRIPT_RE.test(last)) return false;
  if (last === '"') {
    const count = context.split('"').length - 1;
    return count % 2 === 0;
  }
  if (isApostrophe(last)) return endsInsideWord(context);
  return true;
}

/**
 * True if a word written after `context` starts a sentence: the context, ignoring
 * trailing whitespace and opening punctuation (¿ ¡ « ...), is empty or ends with
 * sentence-final punctuation (. ? ! …), optionally followed by closing quotes or
 * brackets.
 */
export function atSentenceStart(context: string): boolean {
  let s = context;
  for (;;) {
    const last = lastChar(s);
    if (last && (isSpace(last) || OPENING_PUNCT.has(last))) s = s.slice(0, s.length - last.length);
    else break;
  }
  for (;;) {
    const last = lastChar(s);
    if (last && CLOSING_PUNCT.has(last) && !endsInsideWord(s)) s = s.slice(0, s.length - last.length);
    else break;
  }
  const last = lastChar(s);
  return last === '' || SENTENCE_END.has(last);
}

/** Uppercase the first letter of `s` (locale-independent), leaving the rest unchanged. */
export function upperFirstLetter(s: string): string {
  return mapFirstLetter(s, (c) => c.toUpperCase());
}

/** Lowercase the first letter of `s` (locale-independent), leaving the rest unchanged. */
export function lowerFirstLetter(s: string): string {
  return mapFirstLetter(s, (c) => c.toLowerCase());
}

/** True if the first letter of `s` is uppercase. */
export function firstLetterIsUpper(s: string): boolean {
  for (const ch of s) {
    if (isLetter(ch)) return UPPER_RE.test(ch);
  }
  return false;
}

function mapFirstLetter(s: string, f: (c: string) => string): string {
  let i = 0;
  for (const ch of s) {
    if (isLetter(ch)) return s.slice(0, i) + f(ch) + s.slice(i + ch.length);
    i += ch.length;
  }
  return s;
}

/**
 * Remove accent marks for accent-insensitive comparison: decompose (NFD), drop the
 * combining marks listed in `marks`, recompose (NFC). Only the listed marks are removed,
 * so ñ (n + tilde) stays ñ with the default set, and non-Latin scripts are untouched.
 */
export function foldAccents(s: string, marks: string = DEFAULT_ACCENT_MARKS): string {
  if (!marks) return s.normalize('NFC');
  const drop = new Set(Array.from(marks));
  let out = '';
  for (const ch of s.normalize('NFD')) if (!drop.has(ch)) out += ch;
  return out.normalize('NFC');
}

/** Lowercase normalization used when no language pack is at hand. */
export function lowercaseNormalize(word: string): string {
  return word.toLowerCase();
}

/** Segments that carry content for answer comparison: words and numbers. */
export function contentSegments(segments: readonly Segment[]): Segment[] {
  return segments.filter((s) => s.kind === 'word' || s.kind === 'number');
}

/**
 * Clean a free answer for scoring: drop leading whitespace and everything after the last
 * word or number segment (trailing punctuation and spaces), as decided by the pack's
 * segmenter. Leading punctuation such as ¿ is kept because it changes what the model
 * scores. Apostrophes that the pack keeps inside a word ('tá, pa') survive. Returns ''
 * when the text has no word or number at all.
 */
export function trimAnswer(pack: LanguagePack, text: string): string {
  const segs = pack.segment(text);
  const content = contentSegments(segs);
  const first = segs.find((s) => s.kind !== 'space');
  const last = content[content.length - 1];
  if (!first || !last) return '';
  return text.slice(first.start, last.end);
}

/**
 * Clamp a log-probability to `floor`. -Infinity, NaN and values below the floor become
 * the floor, so sums stay finite and comparable. Positive values (invalid for a
 * probability) are clamped to 0.
 */
export function clampLogprob(lp: number, floor: number): number {
  if (Number.isNaN(lp) || lp < floor) return floor;
  return lp > 0 ? 0 : lp;
}

/** log(exp(a) + exp(b)) computed without overflow; handles -Infinity. */
export function logAddExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}
